import fs from "node:fs/promises";
import {z} from "zod";
import type {
    PrismaClient,
    TextToImageReferencePromotion,
} from "nbook/server/generated/project-prisma/client";
import {
    TextToImageReferenceAssetNotFoundError,
    publishSourceImage,
} from "nbook/server/text-to-image/reference-asset.service";
import {
    assertTextToImageReferenceMutationScope,
    type TextToImageReferenceMutationScope,
} from "nbook/server/text-to-image/reference-asset-lock";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {ReferenceContentHashSchema} from "nbook/shared/text-to-image-reference-asset";
import {
    verifyReferenceImageBytes,
    type VerifiedReferenceImage,
} from "nbook/server/text-to-image/reference-image";

type ServiceClient = (projectPath: string) => Promise<PrismaClient>;
type ScopeGetter = () => TextToImageReferenceMutationScope;

/** generated 资产 promotion 的不可变准备证据；只携带 contentHash 与稳定 identity，不含字节/路径。 */
export type PreparedGeneratedPromotion = Readonly<{
    projectPath: string;
    generatedAssetId: string;
    expectedContentHash: string;
    evidence: VerifiedReferenceImage;
    referenceAssetId: string;
    promotionId: string;
    sourceKind: "generated-asset";
    sourceId: string;
}>;

/** generated 资产不存在或文件缺失/篡改时的稳定错误。 */
export class TextToImageGeneratedAssetPromotionError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "TextToImageGeneratedAssetPromotionError";
        this.code = code;
    }
}

/** 同一 generated 资产已存在 promotion 时，generated-asset 删除被拒绝的稳定错误。 */
export class TextToImageGeneratedAssetPromotedError extends Error {
    readonly code = "TEXT_TO_IMAGE_GENERATED_ASSET_PROMOTED";

    constructor(readonly generatedAssetId: string) {
        super(`生成资产已被选为参考资产，无法删除：${generatedAssetId}`);
        this.name = "TextToImageGeneratedAssetPromotedError";
    }
}

/**
 * P5 generated-asset → reference-asset promotion 服务。
 *
 * - 只能通过 reference mutation lock 的 scope.promotion port 调用；两个方法都不会
 *   重新获取/释放锁，也不会自开事务（commit 在调用方 Project 事务内执行）。
 * - prepare 验证 generated 记录/文件、发布或复用 content-addressed reference 文件与行，
 *   返回不可变证据；commit 只做 DB create-or-read，冲突证据 fail closed。
 * - 绝不用 selection ID 作为 promotion identity；promotion 按 generated asset 收敛。
 */
export class TextToImageReferencePromotionService {
    private readonly client: ServiceClient;
    private readonly getScope: ScopeGetter;

    constructor(
        getScope: ScopeGetter,
        client: ServiceClient = textToImageProjectClient,
    ) {
        this.getScope = getScope;
        this.client = client;
    }

    /** 在锁内验证 generated 资产并发布/复用 reference 文件，返回不可变准备证据。 */
    async prepareGeneratedPromotion(input: {
        projectPath: string;
        generatedAssetId: string;
        expectedContentHash: string;
    }): Promise<PreparedGeneratedPromotion> {
        const projectPath = z.string().trim().min(1).parse(input.projectPath);
        const generatedAssetId = z.string().trim().min(1).parse(input.generatedAssetId);
        const expectedContentHash = ReferenceContentHashSchema.parse(input.expectedContentHash);
        const scope = this.assertScope(projectPath);
        void scope;

        const db = await this.client(projectPath);
        const asset = await db.textToImageAsset.findUnique({where: {id: generatedAssetId}});
        if (!asset) {
            throw new TextToImageGeneratedAssetPromotionError(
                "TEXT_TO_IMAGE_GENERATED_ASSET_NOT_FOUND",
                `生成资产不存在：${generatedAssetId}`,
            );
        }
        // 已登记的 contentHash 证据必须与调用方冻结期望一致；冲突即 fail closed。
        if (asset.contentHash && asset.contentHash !== expectedContentHash) {
            throw new TextToImageGeneratedAssetPromotionError(
                "TEXT_TO_IMAGE_GENERATED_ASSET_EVIDENCE_CONFLICT",
                "生成资产已登记的内容哈希与期望不一致",
            );
        }
        const absolutePath = resolveTextToImageAssetPath(
            resolveProjectAbsolutePath(projectPath),
            asset.relativePath,
        );
        let bytes: Uint8Array;
        try {
            bytes = await fs.readFile(absolutePath);
        } catch (error) {
            if (isMissingFileError(error)) {
                throw new TextToImageGeneratedAssetPromotionError(
                    "TEXT_TO_IMAGE_GENERATED_ASSET_MISSING",
                    `生成资产文件缺失：${generatedAssetId}`,
                );
            }
            throw error;
        }
        const evidence = await verifyReferenceImageBytes(bytes);
        if (evidence.contentHash !== expectedContentHash) {
            throw new TextToImageGeneratedAssetPromotionError(
                "TEXT_TO_IMAGE_GENERATED_ASSET_EVIDENCE_CONFLICT",
                "生成资产文件内容哈希与期望不一致",
            );
        }
        // 发布/复用 content-addressed reference 文件与行（与 upload 相同孤儿语义）。
        const source = await publishSourceImage(projectPath, db, evidence, bytes, undefined);
        const promotionId = promotionIdFor(generatedAssetId, evidence.contentHash);
        return Object.freeze({
            projectPath,
            generatedAssetId,
            expectedContentHash,
            evidence,
            referenceAssetId: source.id,
            promotionId,
            sourceKind: "generated-asset" as const,
            sourceId: generatedAssetId,
        });
    }

    /** 在调用方 Project 事务内 create-or-read promotion 行；冲突证据 fail closed。 */
    async commitPreparedPromotion(input: {
        transaction: PrismaClient;
        prepared: PreparedGeneratedPromotion;
    }): Promise<TextToImageReferencePromotion> {
        const {transaction, prepared} = input;
        this.assertScope(prepared.projectPath);
        const existing = await transaction.textToImageReferencePromotion.findUnique({
            where: {generatedAssetId: prepared.generatedAssetId},
        });
        if (existing) {
            assertPromotionMatches(existing, prepared);
            return existing;
        }
        try {
            return await transaction.textToImageReferencePromotion.create({
                data: {
                    id: prepared.promotionId,
                    generatedAssetId: prepared.generatedAssetId,
                    generatedAssetContentHash: prepared.evidence.contentHash,
                    referenceContentHash: prepared.evidence.contentHash,
                    sourceKind: prepared.sourceKind,
                    sourceId: prepared.sourceId,
                },
            });
        } catch (error) {
            if (isUniqueConflict(error)) {
                const winner = await transaction.textToImageReferencePromotion.findUnique({
                    where: {generatedAssetId: prepared.generatedAssetId},
                });
                if (!winner) throw error;
                assertPromotionMatches(winner, prepared);
                return winner;
            }
            throw error;
        }
    }

    /** promotion port 必须绑定到与锁完全相同的 Project/root。 */
    private assertScope(projectPath: string): TextToImageReferenceMutationScope {
        const scope = this.getScope();
        assertTextToImageReferenceMutationScope(scope, {
            projectPath,
            projectRoot: resolveProjectAbsolutePath(projectPath),
        });
        return scope;
    }
}

/** 确定性 promotion id：同 generated asset + 同内容收敛到同一行，replay 幂等。 */
export function promotionIdFor(generatedAssetId: string, referenceContentHash: string): string {
    return hashTextToImageContract({
        schemaVersion: "nbook.text-to-image-reference-promotion/v1",
        generatedAssetId,
        referenceContentHash,
        sourceKind: "generated-asset",
    });
}

/** 已有 promotion 与 prepared 证据冲突时 fail closed，绝不静默采纳。 */
function assertPromotionMatches(
    promotion: TextToImageReferencePromotion,
    prepared: PreparedGeneratedPromotion,
): void {
    if (promotion.generatedAssetContentHash !== prepared.evidence.contentHash
        || promotion.referenceContentHash !== prepared.evidence.contentHash
        || promotion.sourceKind !== "generated-asset"
        || promotion.sourceId !== prepared.generatedAssetId) {
        throw new TextToImageGeneratedAssetPromotionError(
            "TEXT_TO_IMAGE_GENERATED_ASSET_PROMOTION_CONFLICT",
            "既有 promotion 与生成资产证据冲突，拒绝采纳",
        );
    }
}

function isUniqueConflict(error: unknown): boolean {
    if (error instanceof Error && "code" in error) {
        return error.code === "P2002" || error.code === "SQLITE_CONSTRAINT_UNIQUE";
    }
    return false;
}

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
