import {randomUUID} from "node:crypto";
import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createIllustrationExecutionManifestHash,
    createIllustrationExecutionSourceIdentityHash,
    IllustrationExecutionAuthorizationSchema,
    IllustrationCompiledRequestSchema,
    type IllustrationCompiledRequest,
    type IllustrationExecutionAuthorization,
    type IllustrationExecutionRegistrationReceipt,
} from "nbook/shared/text-to-image-execution";
import {
    ILLUSTRATION_EXECUTION_PREVIEW_VERSION,
    IllustrationExecutionPreviewSchema,
    type IllustrationExecutionPreview,
} from "nbook/shared/text-to-image-execution-ui";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {
    ILLUSTRATION_COMPILER_VERSION,
    type IllustrationCompileResult,
} from "nbook/server/text-to-image/illustration-compiler";
import {
    deriveIllustrationSeed,
    ExecutionPreviewTokenService,
    type ExecutionPreviewTokenClaims,
} from "nbook/server/text-to-image/execution-preview-token";
import {ProductionIllustrationExecutionCompiler} from "nbook/server/text-to-image/illustration-execution.compiler";
import {
    IllustrationExecutionRepository,
    type IllustrationExecutionRegistrationInput,
} from "nbook/server/text-to-image/execution.repository";
import {PrismaDispatchPreparationRepository} from "nbook/server/text-to-image/dispatch-preparation.repository";
import {IllustrationRegistrationCoordinator} from "nbook/server/text-to-image/illustration-registration.coordinator";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {prisma} from "nbook/server/utils/prisma";

const PreviewInputSchema = z.object({
    projectPath: z.string().trim().min(1).max(1_000),
    ownerUserId: z.number().int().positive().safe(),
}).strict();

export type IllustrationExecutionCompilePort = {
    /** 只读当前 target 的 source identity 与 Recipe seed policy。 */
    readTarget(input: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<{
        sourceIdentityHash: string;
        seedPolicy: {kind: "random"} | {kind: "fixed"; seed: number};
    }>;
    /** 以已冻结 nonce/index/seed 重读当前真相源并编译，不得写文件或数据库。 */
    compile(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderId: string;
        expectedSourceIdentityHash: string;
        executionNonce: string;
        variantIndex: number;
        outputIndex: number;
        outputCount: number;
        seed: number;
    }): Promise<IllustrationCompileResult>;
};

export type IllustrationExecutionServiceErrorCode =
    | "ILLUSTRATION_PREVIEW_INVALID"
    | "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED"
    | "ILLUSTRATION_PREVIEW_NOT_CONFIGURED";

/** Preview 组装与授权重算的稳定错误。 */
export class IllustrationExecutionServiceError extends Error {
    constructor(readonly code: IllustrationExecutionServiceErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationExecutionServiceError";
    }
}

export type IllustrationExecutionRegistrationDraft = Omit<IllustrationExecutionPreview, "previewToken" | "expiresAt"> & {
    executionNonce: string;
    compiledRequests: IllustrationCompiledRequest[];
};

export type IllustrationExecutionRegistrationPort = {
    /** 在单个 Project SQLite transaction 中注册完整 Manifest/approval/Jobs/outbox。 */
    register(input: IllustrationExecutionRegistrationInput): Promise<IllustrationExecutionRegistrationReceipt>;
};

/** 零写入 Execution Preview 编排；持久注册由 Task 7 授权边界负责。 */
export class IllustrationExecutionService {
    private readonly compiler: IllustrationExecutionCompilePort;
    private readonly tokens: ExecutionPreviewTokenService;
    private readonly repository: IllustrationExecutionRegistrationPort | null;
    private readonly nonceFactory: () => string;
    private readonly clock: () => Date;

    constructor(options: {
        compiler: IllustrationExecutionCompilePort;
        tokens: ExecutionPreviewTokenService;
        repository?: IllustrationExecutionRegistrationPort;
        nonceFactory?: () => string;
        clock?: () => Date;
    }) {
        this.compiler = options.compiler;
        this.tokens = options.tokens;
        this.repository = options.repository ?? null;
        this.nonceFactory = options.nonceFactory ?? (() => `execution-${randomUUID()}`);
        this.clock = options.clock ?? (() => new Date());
    }

    /** 为单个已发布 placeholder 签发一个输出的只读 preview。 */
    async previewOne(input: {projectPath: string; ownerUserId: number; placeholderId: string}): Promise<IllustrationExecutionPreview> {
        const parsed = parseTargets(input, [input.placeholderId]);
        return this.issue(await this.compileTargets({...parsed, kind: "single", executionNonce: this.createNonce()}));
    }

    /** 为一组唯一 placeholder 以共享 nonce 做全量无副作用编译。 */
    async previewBatch(input: {projectPath: string; ownerUserId: number; placeholderIds: string[]}): Promise<IllustrationExecutionPreview> {
        const parsed = parseTargets(input, input.placeholderIds);
        return this.issue(await this.compileTargets({...parsed, kind: "batch", executionNonce: this.createNonce()}));
    }

    /**
     * 授权入口复用：以已验签 claims 中的 nonce 重编译单 target。
     * 任一 target/manifest 漂移都只要求重新确认，不返回旧 preview 作为运行真相。
     */
    async recompileOne(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderId: string;
        claims: ExecutionPreviewTokenClaims;
    }): Promise<IllustrationExecutionRegistrationDraft> {
        const parsed = parseTargets(input, [input.placeholderId]);
        const draft = await this.compileTargets({...parsed, kind: "single", executionNonce: input.claims.executionNonce});
        if (draft.targetHash !== input.claims.targetHash || draft.manifestHash !== input.claims.manifestHash) {
            throw new IllustrationExecutionServiceError(
                "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED",
                "Execution Preview 事实已变化，请刷新并重新确认",
            );
        }
        return draft;
    }

    /** 以同一 signed nonce 重编译完整 batch；任一 target 漂移都不注册部分 Job。 */
    async recompileBatch(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderIds: string[];
        claims: ExecutionPreviewTokenClaims;
    }): Promise<IllustrationExecutionRegistrationDraft> {
        const parsed = parseTargets(input, input.placeholderIds);
        const draft = await this.compileTargets({...parsed, kind: "batch", executionNonce: input.claims.executionNonce});
        if (draft.targetHash !== input.claims.targetHash || draft.manifestHash !== input.claims.manifestHash) {
            throw new IllustrationExecutionServiceError(
                "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED",
                "Batch Execution Preview 事实已变化，请刷新并重新确认",
            );
        }
        return draft;
    }

    /** 验签并原子注册一个 button Job；client manifest 必须就是已展示值。 */
    async authorizeOne(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderId: string;
        previewToken: string;
        manifestHash: string;
        authorization: IllustrationExecutionAuthorization;
    }): Promise<IllustrationExecutionRegistrationReceipt> {
        const claims = this.verifyShownManifest(input.previewToken, input.manifestHash);
        const draft = await this.recompileOne({
            projectPath: input.projectPath,
            ownerUserId: input.ownerUserId,
            placeholderId: input.placeholderId,
            claims,
        });
        return await this.register(input, draft);
    }

    /** 验签并把共享 nonce 的完整 batch 作为一个 Project transaction 注册。 */
    async authorizeBatch(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderIds: string[];
        previewToken: string;
        manifestHash: string;
        authorization: IllustrationExecutionAuthorization;
    }): Promise<IllustrationExecutionRegistrationReceipt> {
        const claims = this.verifyShownManifest(input.previewToken, input.manifestHash);
        const draft = await this.recompileBatch({
            projectPath: input.projectPath,
            ownerUserId: input.ownerUserId,
            placeholderIds: input.placeholderIds,
            claims,
        });
        return await this.register(input, draft);
    }

    /** 全部 target 编译成功后才计算 batch manifest；过程中没有可写 port。 */
    private async compileTargets(input: {
        projectPath: string;
        ownerUserId: number;
        placeholderIds: string[];
        kind: "single" | "batch";
        executionNonce: string;
    }): Promise<IllustrationExecutionRegistrationDraft> {
        const targets = await Promise.all(input.placeholderIds.map(async (placeholderId) => {
            const target = await this.compiler.readTarget({
                projectPath: input.projectPath,
                ownerUserId: input.ownerUserId,
                placeholderId,
            });
            return {
                placeholderId,
                sourceIdentityHash: TextToImageContractHashSchema.parse(target.sourceIdentityHash),
                seedPolicy: parseSeedPolicy(target.seedPolicy),
            };
        }));
        const results: IllustrationCompileResult[] = [];
        for (const [outputIndex, target] of targets.entries()) {
            const seed = resolveSeed({
                policy: target.seedPolicy,
                executionNonce: input.executionNonce,
                sourceIdentityHash: target.sourceIdentityHash,
                outputIndex,
            });
            const result = await this.compiler.compile({
                projectPath: input.projectPath,
                ownerUserId: input.ownerUserId,
                placeholderId: target.placeholderId,
                expectedSourceIdentityHash: target.sourceIdentityHash,
                executionNonce: input.executionNonce,
                variantIndex: 0,
                outputIndex,
                outputCount: targets.length,
                seed,
            });
            const request = IllustrationCompiledRequestSchema.parse(result.request);
            const actualIdentity = createIllustrationExecutionSourceIdentityHash(request.source);
            if (actualIdentity !== target.sourceIdentityHash
                || request.parameters.seed !== seed
                || request.provider.ownerUserId !== input.ownerUserId) {
                throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_INVALID", "Compiler 返回的 source/seed/provider 闭包不一致");
            }
            results.push({...result, request});
        }
        const first = results[0];
        if (!first) throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_INVALID", "Preview 没有可执行 target");
        const recipeHash = hashTextToImageContract(first.request.recipeSnapshot);
        const providerHash = hashTextToImageContract(first.request.provider);
        for (const result of results.slice(1)) {
            if (hashTextToImageContract(result.request.recipeSnapshot) !== recipeHash
                || hashTextToImageContract(result.request.provider) !== providerHash) {
                throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_INVALID", "Batch target 必须共享同一 Recipe/Provider snapshot");
            }
        }
        const executionInputHashes = results.map((result) => TextToImageContractHashSchema.parse(result.executionInputHash));
        const compiledRequests = results.map((result) => result.request);
        const manifestHash = createIllustrationExecutionManifestHash({
            executionInputHashes,
            recipeSnapshot: first.request.recipeSnapshot,
            compiledRequests,
            outputCount: results.length,
            knownCost: null,
            tokenLowerBound: null,
        });
        const targetHash = hashTextToImageContract({
            schemaVersion: "nbook.illustration-execution-target-set/v1",
            kind: input.kind,
            targets: results.map((result) => ({
                sourceIdentityHash: createIllustrationExecutionSourceIdentityHash(result.request.source),
                placeholderId: result.request.source.placeholderId,
            })),
        });
        return {
            schemaVersion: ILLUSTRATION_EXECUTION_PREVIEW_VERSION,
            kind: input.kind,
            targetHash,
            executionInputHashes,
            manifestHash,
            outputCount: results.length,
            recipe: {
                recipeId: first.request.recipeSnapshot.recipeId,
                title: first.request.recipeSnapshot.title,
                recipeSourceHash: first.request.recipeSnapshot.recipeSourceHash,
            },
            provider: first.request.provider,
            requests: results.map((result) => ({
                source: result.request.source,
                sourceIdentityHash: createIllustrationExecutionSourceIdentityHash(result.request.source),
                model: result.request.model,
                width: result.request.parameters.width,
                height: result.request.parameters.height,
                seed: result.request.parameters.seed,
                compiledRequestHash: result.request.compiledRequestHash,
                advanced: {
                    aiDefaultCharacterPosition: result.request.parameters.aiDefaultCharacterPosition,
                    variety: result.request.parameters.variety,
                    smeaMode: result.request.parameters.smeaMode,
                    smeaDyn: result.request.parameters.smeaDyn,
                    decrisper: result.request.parameters.decrisper,
                },
                references: {
                    vibeCount: result.request.references.vibeReferences.length,
                    characterCount: result.request.references.characterReferences.length,
                    hasInpaint: result.request.references.inpaint !== null,
                },
            })),
            knownCost: null,
            tokenLowerBound: null,
            warnings: [],
            executionNonce: input.executionNonce,
            compiledRequests,
        };
    }

    /** 只有完整 draft 闭合后才签发 token。 */
    private issue(draft: IllustrationExecutionRegistrationDraft): IllustrationExecutionPreview {
        const signed = this.tokens.issue({
            executionNonce: draft.executionNonce,
            targetHash: draft.targetHash,
            manifestHash: draft.manifestHash,
        });
        const {compiledRequests: _compiledRequests, executionNonce: _executionNonce, ...publicDraft} = draft;
        return IllustrationExecutionPreviewSchema.parse({
            ...publicDraft,
            previewToken: signed.token,
            expiresAt: signed.claims.expiresAt,
        });
    }

    /** 验证 token，并要求浏览器回传的 manifestHash 精确等于已签名值。 */
    private verifyShownManifest(previewToken: string, manifestHashInput: string): ExecutionPreviewTokenClaims {
        const manifestHash = TextToImageContractHashSchema.parse(manifestHashInput);
        const claims = this.tokens.verify(previewToken);
        if (claims.manifestHash !== manifestHash) {
            throw new IllustrationExecutionServiceError(
                "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED",
                "提交的 manifestHash 不是已展示并签名的 Execution Preview",
            );
        }
        return claims;
    }

    /** 把重编译 draft 与当前 actor/授权上限交给唯一原子 repository。 */
    private async register(
        input: {projectPath: string; ownerUserId: number; authorization: IllustrationExecutionAuthorization},
        draft: IllustrationExecutionRegistrationDraft,
    ): Promise<IllustrationExecutionRegistrationReceipt> {
        if (!this.repository) {
            throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_NOT_CONFIGURED", "Execution registration repository 未配置");
        }
        const authorization = IllustrationExecutionAuthorizationSchema.parse(input.authorization);
        if (authorization.authorizedOutputCount !== draft.outputCount
            || (draft.knownCost !== null
                && (authorization.authorizedCostLimit === null || authorization.authorizedCostLimit < draft.knownCost))
            || (draft.tokenLowerBound !== null
                && (authorization.authorizedTokenLimit === null || authorization.authorizedTokenLimit < draft.tokenLowerBound))) {
            throw new IllustrationExecutionServiceError(
                "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED",
                "授权上限不覆盖当前 Execution Preview",
            );
        }
        const approvedAt = this.clock();
        if (Number.isNaN(approvedAt.getTime())) {
            throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_INVALID", "授权时钟返回非法时间");
        }
        return await this.repository.register({
            projectPath: input.projectPath,
            targetHash: draft.targetHash,
            executionNonce: draft.executionNonce,
            executionInputHashes: draft.executionInputHashes,
            executionManifestHash: draft.manifestHash,
            compiledRequests: draft.compiledRequests,
            outputCount: draft.outputCount,
            knownCost: draft.knownCost,
            tokenLowerBound: draft.tokenLowerBound,
            authorization,
            actorUserId: input.ownerUserId,
            approvedAt: approvedAt.toISOString(),
        });
    }

    /** 单次 preview 分配唯一、严格的 nonce。 */
    private createNonce(): string {
        return z.string().trim().min(1).max(200).parse(this.nonceFactory());
    }
}

/** 严格解析 Project/owner 与唯一 placeholder 集。 */
function parseTargets(
    input: {projectPath: string; ownerUserId: number},
    placeholderIdsInput: string[],
): {projectPath: string; ownerUserId: number; placeholderIds: string[]} {
    const base = PreviewInputSchema.parse({projectPath: input.projectPath, ownerUserId: input.ownerUserId});
    const placeholderIds = z.array(z.string().trim().min(1).max(200)).min(1).max(32).parse(placeholderIdsInput);
    if (new Set(placeholderIds).size !== placeholderIds.length) {
        throw new IllustrationExecutionServiceError("ILLUSTRATION_PREVIEW_INVALID", "Batch placeholderId 不能重复");
    }
    return {...base, placeholderIds};
}

/** 收窄 Recipe seed policy。 */
function parseSeedPolicy(input: {kind: "random"} | {kind: "fixed"; seed: number}) {
    return z.discriminatedUnion("kind", [
        z.object({kind: z.literal("random")}).strict(),
        z.object({kind: z.literal("fixed"), seed: z.number().int().min(0).max(4_294_967_295)}).strict(),
    ]).parse(input);
}

/** fixed seed 按输出序号确定性展开；random seed 严格使用冻结 nonce 公式。 */
function resolveSeed(input: {
    policy: {kind: "random"} | {kind: "fixed"; seed: number};
    executionNonce: string;
    sourceIdentityHash: string;
    outputIndex: number;
}): number {
    if (input.policy.kind === "fixed") return (input.policy.seed + input.outputIndex) % 4_294_967_296;
    return deriveIllustrationSeed({
        executionNonce: input.executionNonce,
        sourceIdentityHash: input.sourceIdentityHash,
        variantIndex: 0,
        outputIndex: input.outputIndex,
        compilerVersion: ILLUSTRATION_COMPILER_VERSION,
    });
}

let productionService: IllustrationExecutionService | null = null;

/** 创建使用部署级 session secret 的生产 Preview 服务；不会在 GET 中生成或写入密钥。 */
export function getIllustrationExecutionService(): IllustrationExecutionService {
    if (productionService) return productionService;
    const secret = process.env.NUXT_SESSION_PASSWORD?.trim() ?? "";
    if (Buffer.byteLength(secret, "utf8") < 32) {
        throw new IllustrationExecutionServiceError(
            "ILLUSTRATION_PREVIEW_NOT_CONFIGURED",
            "NUXT_SESSION_PASSWORD 未配置或长度不足，不能签发 Execution Preview",
        );
    }
    const coordinator = new IllustrationRegistrationCoordinator({
        preparation: new PrismaDispatchPreparationRepository(prisma),
        project: {
            async register(projection, stamp) {
                const client = await textToImageProjectClient(projection.input.projectPath);
                return await new IllustrationExecutionRepository(client).register(projection, stamp);
            },
        },
    });
    productionService = new IllustrationExecutionService({
        compiler: new ProductionIllustrationExecutionCompiler(),
        tokens: new ExecutionPreviewTokenService({secret}),
        repository: coordinator,
    });
    return productionService;
}
