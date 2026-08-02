import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {withTextToImageReferenceMutationLock} from "nbook/server/text-to-image/reference-asset-lock";
import {
    TextToImageGeneratedAssetPromotedError,
    TextToImageGeneratedAssetPromotionError,
    TextToImageReferencePromotionService,
    type PreparedGeneratedPromotion,
} from "nbook/server/text-to-image/reference-promotion.service";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {TextToImageReferenceImageError} from "nbook/server/text-to-image/reference-image";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";

describe("TextToImageReferencePromotionService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let assetService: TextToImageAssetService;
    let referenceService: TextToImageReferenceAssetService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/reference-promotion-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(projectPath);
        assetService = new TextToImageAssetService();
        referenceService = new TextToImageReferenceAssetService();
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    async function saveGeneratedAsset(bytes: Uint8Array, overrides: {compiledRequestHash?: string; compiledRevision?: string} = {}): Promise<string> {
        const jobId = randomUUID();
        const db = await openProjectDatabase(projectPath);
        try {
            await db.textToImageJob.create({
                data: {id: jobId, providerId: 1, kind: "illustration", status: "succeeded", requestJson: "{}"},
            });
        } finally {
            db.$disconnect();
        }
        const dto = await assetService.save({
            projectPath,
            jobId,
            bytes,
            mimeType: "image/png",
            width: 3,
            height: 2,
            model: "nai-diffusion-4-5-full",
            seed: 1,
            prompt: "prompt",
            negativePrompt: "",
            sourceKind: "illustration",
            sourcePath: null,
            sourceAnchorId: null,
            ...overrides,
        });
        return dto.id;
    }

    async function promote(generatedAssetId: string, expectedContentHash: string): Promise<{promotion: import("nbook/server/generated/project-prisma/client").TextToImageReferencePromotion; prepared: PreparedGeneratedPromotion}> {
        return await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
            const prepared = await scope.promotion.prepareGeneratedPromotion({
                projectPath,
                generatedAssetId,
                expectedContentHash,
            });
            const db = await openProjectDatabase(projectPath);
            try {
                const promotion = await db.$transaction(async (transaction) => {
                    return await scope.promotion.commitPreparedPromotion({transaction, prepared});
                });
                return {promotion, prepared};
            } finally {
                db.$disconnect();
            }
        });
    }

    it("成功 promotion：复制字节并保留尺寸证据，行持久化 sourceKind/sourceId", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);

        const {promotion, prepared} = await promote(assetId, expectedHash);

        expect(promotion).toMatchObject({
            generatedAssetId: assetId,
            generatedAssetContentHash: expectedHash,
            referenceContentHash: expectedHash,
            sourceKind: "generated-asset",
            sourceId: assetId,
        });
        expect(prepared.evidence).toEqual({
            contentHash: expectedHash,
            mimeType: "image/png",
            byteLength: bytes.byteLength,
            width: 3,
            height: 2,
        });
        // reference asset 文件字节与 generated 一致。
        const reference = await referenceService.read(projectPath, expectedHash);
        const content = await referenceService.content(projectPath, reference.id);
        await expect(fs.readFile(content.absolutePath)).resolves.toEqual(Buffer.from(bytes));
    });

    it("同一 generated 资产重放返回同一 promotion，不重复建行", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);

        const first = await promote(assetId, expectedHash);
        const second = await promote(assetId, expectedHash);

        expect(second.promotion.id).toBe(first.promotion.id);
        const db = await openProjectDatabase(projectPath);
        try {
            expect(await db.textToImageReferencePromotion.count()).toBe(1);
        } finally {
            db.$disconnect();
        }
    });

    it("两个不同 generated 资产相同字节：一个 content-addressed reference、两个 promotion 行", async () => {
        const bytes = await createImage("png");
        const firstAsset = await saveGeneratedAsset(bytes);
        const secondAsset = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);

        const first = await promote(firstAsset, expectedHash);
        const second = await promote(secondAsset, expectedHash);

        expect(first.promotion.referenceContentHash).toBe(second.promotion.referenceContentHash);
        expect(first.promotion.id).not.toBe(second.promotion.id);
        const db = await openProjectDatabase(projectPath);
        try {
            expect(await db.textToImageReferenceAsset.count()).toBe(1);
            expect(await db.textToImageReferencePromotion.count()).toBe(2);
        } finally {
            db.$disconnect();
        }
    });

    it("expectedContentHash 与文件内容不符时 fail closed，且不发布任何 reference", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);

        await expect(promote(assetId, "b".repeat(64))).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_GENERATED_ASSET_EVIDENCE_CONFLICT",
        });
        const db = await openProjectDatabase(projectPath);
        try {
            expect(await db.textToImageReferencePromotion.count()).toBe(0);
            expect(await db.textToImageReferenceAsset.count()).toBe(0);
        } finally {
            db.$disconnect();
        }
    });

    it("生成资产文件缺失时抛稳定错误", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const content = await assetService.content(projectPath, assetId);
        await fs.rm(content.absolutePath);

        await expect(promote(assetId, sha256Hex(bytes))).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_GENERATED_ASSET_MISSING",
        });
    });

    it("生成资产文件被篡改为不可解码字节：完整解码失败 fail closed", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const content = await assetService.content(projectPath, assetId);
        await fs.writeFile(content.absolutePath, Buffer.from("not-an-image"));

        await expect(promote(assetId, sha256Hex(bytes))).rejects.toBeInstanceOf(TextToImageReferenceImageError);
    });

    it("生成资产行不存在抛稳定错误", async () => {
        await expect(promote(randomUUID(), "b".repeat(64))).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_GENERATED_ASSET_NOT_FOUND",
        });
    });

    it("既有 promotion 与准备证据冲突时 fail closed，不静默采纳", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);
        const db = await openProjectDatabase(projectPath);
        try {
            await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
                const prepared = await scope.promotion.prepareGeneratedPromotion({
                    projectPath,
                    generatedAssetId: assetId,
                    expectedContentHash: expectedHash,
                });
                await db.$transaction(async (transaction) => {
                    await scope.promotion.commitPreparedPromotion({transaction, prepared});
                });
                // 手动损坏既有行的固定 source identity，与 prepared 冲突。
                await db.textToImageReferencePromotion.update({
                    where: {id: prepared.promotionId},
                    data: {sourceId: "other-asset"},
                });
                await expect(db.$transaction(async (transaction) => {
                    return await scope.promotion.commitPreparedPromotion({transaction, prepared});
                })).rejects.toMatchObject({code: "TEXT_TO_IMAGE_GENERATED_ASSET_PROMOTION_CONFLICT"});
            });
        } finally {
            db.$disconnect();
        }
    });

    it("prepare 只发布 reference，不写 promotion；调用方事务失败只留可重放的孤儿", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);
        const db = await openProjectDatabase(projectPath);
        try {
            await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
                const prepared = await scope.promotion.prepareGeneratedPromotion({
                    projectPath,
                    generatedAssetId: assetId,
                    expectedContentHash: expectedHash,
                });
                // prepare 之后、commit 之前：无 promotion 行，但 reference 行+文件已发布。
                expect(await db.textToImageReferencePromotion.count()).toBe(0);
                expect(await db.textToImageReferenceAsset.count()).toBe(1);
                // 调用方事务中途失败：promotion 不落库。
                await expect(db.$transaction(async (transaction) => {
                    await scope.promotion.commitPreparedPromotion({transaction, prepared});
                    throw new Error("caller transaction failure");
                })).rejects.toThrow("caller transaction failure");
                expect(await db.textToImageReferencePromotion.count()).toBe(0);
                // reference 文件仍是已验证的 content-addressed 孤儿，重放可采纳。
                const reference = await referenceService.read(projectPath, expectedHash);
                const content = await referenceService.content(projectPath, reference.id);
                await expect(fs.readFile(content.absolutePath)).resolves.toEqual(Buffer.from(bytes));
            });
        } finally {
            db.$disconnect();
        }
    });

    it("promotion 存在后 generated-asset 删除被拒绝（稳定 owner 错误）", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        await promote(assetId, sha256Hex(bytes));

        await expect(assetService.delete(projectPath, assetId)).rejects.toBeInstanceOf(
            TextToImageGeneratedAssetPromotedError,
        );
    });

    it("锁内并发：promotion 先完成则删除失败；删除先完成则 promotion 失败 missing", async () => {
        const bytes = await createImage("png");
        const assetId = await saveGeneratedAsset(bytes);
        const expectedHash = sha256Hex(bytes);

        // 顺序 1：先 promote 再 delete → delete 失败 promoted。
        await promote(assetId, expectedHash);
        await expect(assetService.delete(projectPath, assetId)).rejects.toBeInstanceOf(
            TextToImageGeneratedAssetPromotedError,
        );

        // 顺序 2：新资产先 delete 再 promote → promote 失败 missing（行已删）。
        const secondId = await saveGeneratedAsset(await createImage("png", "#223344"));
        await assetService.delete(projectPath, secondId);
        await expect(promote(secondId, sha256Hex(await createImage("png", "#223344")))).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_GENERATED_ASSET_NOT_FOUND",
        });
    });
});

async function createImage(format: "png" | "jpeg", background = "#4d65ff"): Promise<Buffer> {
    const image = sharp({
        create: {width: 3, height: 2, channels: 4, background},
    });
    return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function openProjectDatabase(projectPath: string): Promise<import("nbook/server/generated/project-prisma/client").PrismaClient> {
    const {textToImageProjectClient} = await import("nbook/server/text-to-image/project-client");
    return await textToImageProjectClient(projectPath);
}
