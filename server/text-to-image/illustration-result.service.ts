import {z} from "zod";
import {
    createTextToImageJobSourceIdentityHash,
    IllustrationCompiledRequestSchema,
    TextToImageJobOriginSchema,
} from "nbook/shared/text-to-image-execution";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import type {PrismaClient} from "nbook/server/generated/project-prisma/client";

const ResultInputSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    jobId: z.string().trim().min(1).max(200),
    assetId: z.string().trim().min(1).max(200),
    attemptFence: z.object({
        attemptId: z.string().trim().min(1).max(200),
        fencingVersion: z.number().int().positive().safe(),
    }).strict(),
}).strict();

export type IllustrationResultStatus = "inserted" | "missing" | "late";

export type IllustrationResultReceipt = {
    jobId: string;
    assetId: string;
    status: IllustrationResultStatus;
};

export class IllustrationResultError extends Error {
    readonly code = "ILLUSTRATION_RESULT_INVALID";

    constructor(message: string) {
        super(`${"ILLUSTRATION_RESULT_INVALID"}: ${message}`);
        this.name = "IllustrationResultError";
    }
}

/** Route B Asset → 正文 exact replacement 与 Project Job terminal CAS 的唯一入口。 */
export class IllustrationResultService {
    private readonly assets: TextToImageAssetService;
    private readonly chapters: TextToImageChapterService;
    private readonly client: (projectPath: string) => Promise<PrismaClient>;

    constructor(options: {
        assets?: TextToImageAssetService;
        chapters?: TextToImageChapterService;
        client?: (projectPath: string) => Promise<PrismaClient>;
    } = {}) {
        this.assets = options.assets ?? new TextToImageAssetService();
        this.chapters = options.chapters ?? new TextToImageChapterService();
        this.client = options.client ?? textToImageProjectClient;
    }

    /** attempt fence 不匹配时只返回 late；匹配结果会保留 Asset 并精确更新正文/Job。 */
    async applyAssetResult(rawInput: {
        projectPath: string;
        jobId: string;
        assetId: string;
        attemptFence: {attemptId: string; fencingVersion: number};
    }): Promise<IllustrationResultReceipt> {
        const input = ResultInputSchema.parse(rawInput);
        const client = await this.client(input.projectPath);
        const job = await client.textToImageJob.findUnique({where: {id: input.jobId}});
        if (!job) throw new IllustrationResultError("Job 不存在");
        const requestResult = IllustrationCompiledRequestSchema.safeParse(parseJson(job.requestJson, "Job requestJson"));
        if (!requestResult.success) throw new IllustrationResultError("Job requestJson 不符合 CompiledRequest 契约");
        const originResult = TextToImageJobOriginSchema.safeParse(parseJson(job.originJson, "Job originJson"));
        if (!originResult.success) throw new IllustrationResultError("Job originJson 不符合 button origin 契约");
        const request = requestResult.data;
        const origin = originResult.data;
        const asset = await this.assets.read(input.projectPath, input.assetId);
        assertLineage({job, request, origin, asset});

        if (job.activeAttemptId !== input.attemptFence.attemptId
            || job.activeAttemptFence !== input.attemptFence.fencingVersion) {
            return {jobId: job.id, assetId: asset.id, status: "late"};
        }
        const terminal = terminalReceipt(job, asset.id);
        if (terminal) return terminal;
        if (job.status !== "completing") {
            return {jobId: job.id, assetId: asset.id, status: "late"};
        }

        const replacement = await this.chapters.replaceIllustrationPrompt({
            projectPath: input.projectPath,
            source: request.source,
            asset,
        });
        const status: IllustrationResultStatus = replacement === "mismatch" ? "late" : replacement;
        const stableErrorCode = replacement === "mismatch" ? "ILLUSTRATION_PLACEHOLDER_STALE" : null;
        const completed = await client.textToImageJob.updateMany({
            where: {
                id: job.id,
                kind: "illustration",
                status: "completing",
                activeAttemptId: input.attemptFence.attemptId,
                activeAttemptFence: input.attemptFence.fencingVersion,
                compiledRequestHash: request.compiledRequestHash,
            },
            data: {
                status: "succeeded",
                finishedAt: new Date(),
                resultAssetIdsJson: JSON.stringify([asset.id]),
                sourceInsertStatus: replacement === "inserted" ? "inserted" : "missing",
                stableErrorCode,
                errorMessage: null,
            },
        });
        if (completed.count !== 1) {
            const current = await client.textToImageJob.findUnique({where: {id: job.id}});
            const converged = current ? terminalReceipt(current, asset.id) : null;
            if (converged) return converged;
            return {jobId: job.id, assetId: asset.id, status: "late"};
        }
        return {jobId: job.id, assetId: asset.id, status};
    }
}

/** Job、CompiledRequest、origin 与 Asset 必须形成同一不可变 lineage。 */
function assertLineage(input: {
    job: {
        id: string;
        providerId: number;
        kind: string;
        sourcePath: string | null;
        sourceAnchorId: string | null;
        sourceIdentityHash: string | null;
        providerOwnerUserId: number | null;
        providerCredentialRevision: number | null;
        compiledRequestHash: string | null;
    };
    request: z.infer<typeof IllustrationCompiledRequestSchema>;
    origin: z.infer<typeof TextToImageJobOriginSchema>;
    asset: {
        id: string;
        jobId: string;
        sourceKind: string;
        sourcePath: string | null;
        sourceAnchorId: string | null;
    };
}): void {
    if (input.job.kind !== "illustration" || input.origin.kind !== "button") {
        throw new IllustrationResultError("只有 Route B button Job 可以替换 V2 placeholder");
    }
    const sourceIdentityHash = createTextToImageJobSourceIdentityHash(input.origin);
    TextToImageContractHashSchema.parse(sourceIdentityHash);
    if (input.asset.jobId !== input.job.id
        || input.asset.sourceKind !== "illustration"
        || input.asset.sourcePath !== input.request.source.chapterPath
        || input.asset.sourceAnchorId !== input.request.source.placeholderId
        || input.job.providerId !== input.request.provider.providerId
        || input.job.providerOwnerUserId !== input.request.provider.ownerUserId
        || input.job.providerCredentialRevision !== input.request.provider.credentialRevision
        || input.job.sourcePath !== input.request.source.chapterPath
        || input.job.sourceAnchorId !== input.request.source.placeholderId
        || input.job.sourceIdentityHash !== sourceIdentityHash
        || input.job.compiledRequestHash !== input.request.compiledRequestHash
        || input.origin.chapterPath !== input.request.source.chapterPath
        || input.origin.placeholderId !== input.request.source.placeholderId
        || input.origin.shotId !== input.request.source.shotId
        || input.origin.shotOrigin !== input.request.source.shotOrigin) {
        throw new IllustrationResultError("Job/source/origin lineage 不闭合");
    }
    if (!input.asset.id.trim() || input.asset.jobId.trim() === "") {
        throw new IllustrationResultError("Asset identity 不合法");
    }
}

/** 相同 attempt/asset 的重复完成返回已有 terminal receipt。 */
function terminalReceipt(
    job: {id: string; status: string; sourceInsertStatus: string; resultAssetIdsJson: string; stableErrorCode: string | null},
    assetId: string,
): IllustrationResultReceipt | null {
    if (job.status !== "succeeded") return null;
    const assetIds = z.array(z.string().trim().min(1).max(200)).parse(parseJson(job.resultAssetIdsJson, "Job resultAssetIdsJson"));
    if (!assetIds.includes(assetId)) return null;
    const status: IllustrationResultStatus = job.stableErrorCode === "ILLUSTRATION_PLACEHOLDER_STALE"
        ? "late"
        : job.sourceInsertStatus === "inserted" ? "inserted" : "missing";
    return {jobId: job.id, assetId, status};
}

/** JSON 字段只在数据库边界为 unknown，随后立即由严格 schema 收窄。 */
function parseJson(value: string | null, field: string): unknown {
    if (value === null) throw new IllustrationResultError(`${field} 缺失`);
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new IllustrationResultError(`${field} 不是合法 JSON`);
    }
}
