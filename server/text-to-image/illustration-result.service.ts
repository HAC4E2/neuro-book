import {z} from "zod";
import {
    createTextToImageJobSourceIdentityHash,
    IllustrationCompiledRequestSchema,
    TextToImageJobOriginSchema,
} from "nbook/shared/text-to-image-execution";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {renderTextToImageAssetMarkdown} from "nbook/shared/text-to-image-markdown";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {TextToImageChapterService} from "nbook/server/text-to-image/chapter.service";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import {stripOwnedAssetMarkdown} from "nbook/server/text-to-image/illustration-execution.compiler";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {TextToImageRecipeService} from "nbook/server/text-to-image/recipe.service";
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

const RestoreInputSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    ownerUserId: z.number().int().positive().safe(),
    jobId: z.string().trim().min(1).max(200),
    assetId: z.string().trim().min(1).max(200),
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
    private readonly recipes: TextToImageRecipeService;

    constructor(options: {
        assets?: TextToImageAssetService;
        chapters?: TextToImageChapterService;
        client?: (projectPath: string) => Promise<PrismaClient>;
        recipes?: TextToImageRecipeService;
    } = {}) {
        this.assets = options.assets ?? new TextToImageAssetService();
        this.chapters = options.chapters ?? new TextToImageChapterService();
        this.client = options.client ?? textToImageProjectClient;
        this.recipes = options.recipes ?? new TextToImageRecipeService();
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

    /**
     * 重roll第一步（用户显式触发）：把已插入正文的成功结果还原为原 V2 placeholder，
     * 并把 Job 的 sourceInsertStatus 收敛为 missing，让占位块状态服务放行再次生成。
     * 图片被手工改动或已不在正文时零写入并返回稳定结果码；旧 Asset/PNG 一律保留。
     */
    async restoreAssetPlaceholder(rawInput: {
        projectPath: string;
        ownerUserId: number;
        jobId: string;
        assetId: string;
    }): Promise<{jobId: string; assetId: string; status: "restored" | "already_placeholder" | "asset_markdown_missing" | "asset_markdown_ambiguous"}> {
        const input = RestoreInputSchema.parse(rawInput);
        const client = await this.client(input.projectPath);
        const job = await client.textToImageJob.findUnique({where: {id: input.jobId}});
        if (!job) throw new IllustrationResultError("Job 不存在");
        if (job.providerOwnerUserId !== input.ownerUserId) throw new IllustrationResultError("Job 不属于当前用户");
        if (job.status !== "succeeded") throw new IllustrationResultError("只有成功插入的结果可以还原为占位块");
        const requestResult = IllustrationCompiledRequestSchema.safeParse(parseJson(job.requestJson, "Job requestJson"));
        if (!requestResult.success) throw new IllustrationResultError("Job requestJson 不符合 CompiledRequest 契约");
        const originResult = TextToImageJobOriginSchema.safeParse(parseJson(job.originJson, "Job originJson"));
        if (!originResult.success) throw new IllustrationResultError("Job originJson 不符合 button origin 契约");
        const request = requestResult.data;
        const asset = await this.assets.read(input.projectPath, input.assetId);
        assertLineage({job, request, origin: originResult.data, asset});

        // 固定 seed 下重新注册会收敛为同一 compiledRequestHash 的原任务，重roll没有意义且必然 409；
        // 在破坏性还原之前就拒绝，并给出可执行的引导。
        const recipe = await this.recipes.read(input.projectPath);
        if (recipe.exists && recipe.source.seed.policy === "fixed") {
            throw new IllustrationResultError("当前 Recipe 使用固定 seed，重新生成会得到完全相同的图片；请先在设置中把 seed 策略改为随机。");
        }

        // 正文在插图生成后被编辑过时，还原出的占位块必然编译失败（sourceChapterHash 漂移）。
        // 与 Execution Compiler 同款管线预检：先剔除本章全部 canonical 图片 Markdown，再比对语义 hash；
        // 漂移则零写入，保住正文里的图片引用。
        const snapshot = await this.chapters.snapshot(input.projectPath, request.source.chapterPath);
        const chapterAssets = await client.textToImageAsset.findMany({where: {sourcePath: request.source.chapterPath}});
        const ownedAssetMarkdown = chapterAssets.map((row) => renderTextToImageAssetMarkdown({
            id: row.id,
            jobId: row.jobId,
            relativePath: row.relativePath,
            fileName: row.fileName,
            mimeType: row.mimeType,
            byteLength: row.byteLength,
            width: row.width,
            height: row.height,
            model: row.model,
            seed: row.seed,
            prompt: row.prompt,
            negativePrompt: row.negativePrompt,
            sourceKind: row.sourceKind,
            sourcePath: row.sourcePath,
            sourceAnchorId: row.sourceAnchorId,
            createdAt: row.createdAt.toISOString(),
        }));
        let currentChapterHash: string;
        try {
            currentChapterHash = new IllustrationChapterParser().parse({
                chapterPath: request.source.chapterPath,
                markdown: stripOwnedAssetMarkdown(snapshot.markdown, ownedAssetMarkdown),
            }).sourceChapterHash;
        } catch {
            throw new IllustrationResultError("当前章节结构无法解析，重新生成前请先重新规划该章节；本次未修改正文。");
        }
        if (currentChapterHash !== request.source.sourceChapterHash) {
            throw new IllustrationResultError("正文在插图生成后已被编辑，重新生成前请先对该章节重新规划；本次未修改正文。");
        }

        const status = await this.chapters.restoreIllustrationPrompt({
            projectPath: input.projectPath,
            source: request.source,
            asset,
        });
        if (status !== "asset_markdown_missing") {
            await client.textToImageJob.updateMany({
                where: {id: job.id, kind: "illustration", status: "succeeded"},
                data: {sourceInsertStatus: "missing"},
            });
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
