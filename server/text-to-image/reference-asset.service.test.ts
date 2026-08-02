import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    TextToImageReferenceAssetDtoSchema,
    TextToImageReferenceAssetPageDtoSchema,
} from "nbook/shared/text-to-image-reference-asset";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
    TextToImageReferenceAssetService,
} from "nbook/server/text-to-image/reference-asset.service";
import {TextToImageReferenceImageError} from "nbook/server/text-to-image/reference-image";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";

describe("TextToImageReferenceAssetService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let service: TextToImageReferenceAssetService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/text-to-image-reference-assets-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(projectPath);
        service = new TextToImageReferenceAssetService();
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("上传完整解码的 PNG：id 等于字节 SHA-256，DTO 只暴露 source 元数据", async () => {
        const bytes = await createImage("png");
        const dto = await service.upload({projectPath, bytes, fileName: "参考图.png"});

        const expectedHash = createHash("sha256").update(bytes).digest("hex");
        expect(dto).toEqual({
            id: expectedHash,
            kind: "source-image",
            contentHash: expectedHash,
            fileName: "参考图.png",
            mimeType: "image/png",
            byteLength: bytes.byteLength,
            width: 3,
            height: 2,
            status: "available",
            createdAt: expect.any(String),
        });
        expect(TextToImageReferenceAssetDtoSchema.parse(dto)).toEqual(dto);

        const relativePath = `.nbook/text-to-image/references/${expectedHash.slice(0, 2)}/${expectedHash}.png`;
        const absolutePath = await resolveProjectFilePath(projectPath, relativePath);
        await expect(fs.readFile(absolutePath)).resolves.toEqual(Buffer.from(bytes));
    });

    it("相同字节但客户端 MIME/文件名不同会收敛到同一资产，且文件只落一份", async () => {
        const bytes = await createImage("jpeg");
        const first = await service.upload({projectPath, bytes, fileName: "a.jpg"});
        const second = await service.upload({projectPath, bytes, fileName: "b.jpeg"});

        expect(second.id).toBe(first.id);
        expect(second.contentHash).toBe(first.contentHash);
        // 内容寻址收敛：第二次上传不会改写既有资产的展示文件名。
        expect(second.fileName).toBe("a.jpg");

        expect(await publishedFiles(await referenceRoot(projectPath))).toHaveLength(1);
    });

    it("并发相同哈希上传都成功并共享一个 DB/file pair", async () => {
        const bytes = await createImage("png");
        const [first, second] = await Promise.all([
            service.upload({projectPath, bytes, fileName: "concurrent.png"}),
            service.upload({projectPath, bytes, fileName: "concurrent.png"}),
        ]);
        expect(first.id).toBe(second.id);
        expect(await service.list({projectPath, page: 1, pageSize: 10})).toMatchObject({
            items: [{id: first.id}],
            page: 1,
            pageSize: 10,
            hasMore: false,
        });
        expect(await publishedFiles(await referenceRoot(projectPath))).toHaveLength(1);
    });

    it("失败的上传不会删除已存在的胜者资产", async () => {
        const bytes = await createImage("png");
        const winner = await service.upload({projectPath, bytes, fileName: "winner.png"});

        // 同哈希请求在锁内失败（这里用无效图片制造 verify 失败路径）。
        await expect(service.upload({
            projectPath,
            bytes: Buffer.from("not-an-image"),
            fileName: "loser.png",
        })).rejects.toBeInstanceOf(TextToImageReferenceImageError);

        const dto = await service.read(projectPath, winner.id);
        expect(dto.status).toBe("available");
        const content = await service.content(projectPath, winner.id);
        await expect(fs.readFile(content.absolutePath)).resolves.toEqual(Buffer.from(bytes));
    });

    it("孤儿文件被采纳：文件在、行不在时重新上传直接复用文件", async () => {
        const bytes = await createImage("png");
        const first = await service.upload({projectPath, bytes, fileName: "orphan.png"});
        const content = await service.content(projectPath, first.id);

        // 删除 DB 行，保留文件，模拟中断在 DB 写入前的孤儿文件。
        const db = await openProjectDatabase(projectPath);
        try {
            await db.textToImageReferenceAsset.delete({where: {id: first.id}});
        } finally {
            db.$disconnect();
        }

        const adopted = await service.upload({projectPath, bytes, fileName: "orphan.png"});
        expect(adopted.id).toBe(first.id);
        const after = await service.content(projectPath, adopted.id);
        expect(after.absolutePath).toBe(content.absolutePath);
        expect(await publishedFiles(await referenceRoot(projectPath))).toHaveLength(1);
    });

    it("被篡改的孤儿文件 fail closed：不覆盖、不删除", async () => {
        const bytes = await createImage("png");
        const first = await service.upload({projectPath, bytes, fileName: "tampered-orphan.png"});
        const content = await service.content(projectPath, first.id);

        const db = await openProjectDatabase(projectPath);
        try {
            await db.textToImageReferenceAsset.delete({where: {id: first.id}});
        } finally {
            db.$disconnect();
        }
        await fs.writeFile(content.absolutePath, Buffer.from("tampered-bytes"));

        await expect(service.upload({projectPath, bytes, fileName: "tampered-orphan.png"})).rejects.toMatchObject({
            code: "REFERENCE_ASSET_TAMPERED",
        });

        await expect(fs.readFile(content.absolutePath, "utf8")).resolves.toBe("tampered-bytes");
        await expect(service.list({projectPath, page: 1, pageSize: 10})).resolves.toMatchObject({items: []});
    });

    it("行存在但文件缺失：read 返回 missing，content 稳定报错", async () => {
        const bytes = await createImage("png");
        const dto = await service.upload({projectPath, bytes, fileName: "missing.png"});
        const content = await service.content(projectPath, dto.id);
        await fs.rm(content.absolutePath);

        await expect(service.read(projectPath, dto.id)).resolves.toMatchObject({status: "missing"});
        await expect(service.content(projectPath, dto.id)).rejects.toMatchObject({code: "REFERENCE_ASSET_MISSING"});
    });

    it("文件被篡改（尺寸不符）：read 返回 tampered，content 完整复验后报错", async () => {
        const bytes = await createImage("png");
        const dto = await service.upload({projectPath, bytes, fileName: "tampered.png"});
        const content = await service.content(projectPath, dto.id);

        // 覆盖为不同字节长度且不可解码的字节，stat 与完整复验都会失败。
        await fs.writeFile(content.absolutePath, Buffer.from("tampered-bytes"));
        const stat = await fs.stat(content.absolutePath);
        expect(stat.size).not.toBe(dto.byteLength);

        await expect(service.read(projectPath, dto.id)).resolves.toMatchObject({status: "tampered"});
        await expect(service.content(projectPath, dto.id)).rejects.toMatchObject({code: "REFERENCE_ASSET_TAMPERED"});
    });

    it("list 分页返回严格 page DTO，且只做 stat 级检查", async () => {
        const uploaded: string[] = [];
        for (let index = 0; index < 3; index += 1) {
            const bytes = await createImage("png", `#4d65f${index}`);
            const dto = await service.upload({projectPath, bytes, fileName: `page-${index}.png`});
            uploaded.push(dto.id);
        }
        // 制造一个 missing：删除最新上传的文件，使其出现在第一页。
        const content = await service.content(projectPath, uploaded[2]!);
        await fs.rm(content.absolutePath);

        const page = await service.list({projectPath, page: 1, pageSize: 2});
        expect(TextToImageReferenceAssetPageDtoSchema.parse(page)).toEqual(page);
        expect(page).toMatchObject({page: 1, pageSize: 2, hasMore: true});
        // createdAt 秒级精度可能相同，顺序按 id 兜底，这里只断言状态集合。
        expect(page.items.map((item) => item.status).sort()).toEqual(["available", "missing"]);

        const second = await service.list({projectPath, page: 2, pageSize: 2});
        expect(second.items).toHaveLength(1);
        expect(second.hasMore).toBe(false);
    });

    it("read 不存在的资产抛稳定错误", async () => {
        await expect(service.read(projectPath, "a".repeat(64))).rejects.toBeInstanceOf(
            TextToImageReferenceAssetNotFoundError,
        );
    });

    it("readByContentHashes 按 contentHash 批量读取", async () => {
        const bytes = await createImage("png");
        const dto = await service.upload({projectPath, bytes, fileName: "batch.png"});

        const map = await service.readByContentHashes(projectPath, [dto.contentHash, "0".repeat(64)]);
        expect(map.get(dto.contentHash)?.id).toBe(dto.id);
        expect(map.has("0".repeat(64))).toBe(false);
    });

    it("删除成功后文件与行成对清理，不残留 temp", async () => {
        const bytes = await createImage("png");
        const dto = await service.upload({projectPath, bytes, fileName: "delete.png"});
        const content = await service.content(projectPath, dto.id);

        await service.delete(projectPath, dto.id);

        await expect(service.read(projectPath, dto.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);
        await expect(fs.stat(content.absolutePath)).rejects.toMatchObject({code: "ENOENT"});
        expect(await publishedFiles(await referenceRoot(projectPath))).toHaveLength(0);
    });

    it("被 Vibe lineage 引用的 source 拒绝删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "vibe-source.png"});
        await service.storeVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
            bytes: new Uint8Array([1, 2, 3, 4]),
        });

        await expect(service.delete(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetInUseError);
        await expect(service.read(projectPath, source.id)).resolves.toMatchObject({status: "available"});
    });

    it("被 promotion 引用的 source 拒绝删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "promoted-source.png"});

        const db = await openProjectDatabase(projectPath);
        try {
            await db.textToImageJob.create({
                data: {
                    id: "promotion-job-1",
                    providerId: 1,
                    kind: "illustration",
                    status: "succeeded",
                    requestJson: "{}",
                },
            });
            await db.textToImageAsset.create({
                data: {
                    id: "generated-asset-1",
                    jobId: "promotion-job-1",
                    relativePath: "assets/text-to-image/2026/08/generated-asset-1.png",
                    fileName: "generated-asset-1.png",
                    mimeType: "image/png",
                    byteLength: 12,
                    width: 3,
                    height: 2,
                    model: "nai-diffusion-4-5-full",
                    seed: 1,
                    prompt: "",
                    negativePrompt: "",
                    sourceKind: "illustration",
                },
            });
            await db.textToImageReferencePromotion.create({
                data: {
                    id: randomUUID(),
                    generatedAssetId: "generated-asset-1",
                    generatedAssetContentHash: "1".repeat(64),
                    referenceContentHash: source.contentHash,
                    sourceKind: "generated-asset",
                    sourceId: "generated-asset-1",
                },
            });
        } finally {
            db.$disconnect();
        }

        await expect(service.delete(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetInUseError);
    });

    it("storeVibeEncoding 幂等写入 typed lineage，findVibeEncoding 按 cache key 命中", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "vibe.png"});
        const encodingBytes = new Uint8Array([9, 8, 7, 6, 5]);

        await service.storeVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
            bytes: encodingBytes,
        });
        // 同 key 重放幂等；不同 informationExtracted 是另一个 cache key。
        await service.storeVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
            bytes: encodingBytes,
        });

        await expect(service.findVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
        })).resolves.toEqual(Buffer.from(encodingBytes));

        await expect(service.findVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.5,
        })).resolves.toBeNull();

        await expect(service.findVibeEncoding({
            projectPath,
            sourceContentHash: "f".repeat(64),
            model: "nai-diffusion-4-5-full",
            informationExtracted: 0.7,
        })).resolves.toBeNull();
    });

    it("被 Recipe 参考资源引用拒绝删除（Recipe 通过 codec 严格解析）", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "recipe-owner.png"});
        await writeRecipeWithVibeReference(projectPath, source.contentHash);

        await expect(service.delete(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetInUseError);
        await expect(service.read(projectPath, source.id)).resolves.toMatchObject({status: "available"});
    });

    it("Recipe 引用解除后可删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "recipe-owner.png"});
        await writeRecipeWithVibeReference(projectPath, source.contentHash);

        await writeRecipeWithVibeReference(projectPath, "f".repeat(64));  // 换成其它 hash
        await expect(service.delete(projectPath, source.id)).resolves.toBeUndefined();
    });

    it("被已提交 Manifest 的 strict CompiledRequest 引用拒绝删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "manifest-owner.png"});
        const {createIllustrationCompiledRequestHash} = await import("nbook/shared/text-to-image-execution");
        const {illustrationCompiledRequestFixture} = await import("nbook/server/text-to-image/execution.test-fixtures");
        const {compiledRequestHash: _omit, ...base} = illustrationCompiledRequestFixture(0);
        const requestBase = {
            ...base,
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash: source.contentHash, strength: 0.6, informationExtracted: 0.7}],
                characterReferences: [],
                inpaint: null,
            },
        };
        const request = {...requestBase, compiledRequestHash: createIllustrationCompiledRequestHash(requestBase)};
        const db = await openProjectDatabase(projectPath);
        try {
            await db.illustrationExecutionManifest.create({
                data: {
                    id: "manifest-owner-1",
                    projectId: "project-1",
                    targetHash: "a".repeat(64),
                    executionNonce: "nonce",
                    executionInputHashesJson: "[]",
                    executionManifestHash: "b".repeat(64),
                    recipeSnapshotJson: "{}",
                    compiledRequestsJson: JSON.stringify([request]),
                    outputCount: 1,
                    additionalCostLowerBound: null,
                    tokenLowerBound: null,
                },
            });
        } finally {
            db.$disconnect();
        }

        await expect(service.delete(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetInUseError);
    });

    it("Recipe/Manifest owner 证据损坏时 REFERENCE_OWNER_EVIDENCE_INVALID，而非当成无 owner", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "broken-owner.png"});
        // Manifest compiledRequestsJson 不是合法 CompiledRequest。
        const db = await openProjectDatabase(projectPath);
        try {
            await db.illustrationExecutionManifest.create({
                data: {
                    id: "broken-manifest-1",
                    projectId: "project-1",
                    targetHash: "a".repeat(64),
                    executionNonce: "nonce",
                    executionInputHashesJson: "[]",
                    executionManifestHash: "b".repeat(64),
                    recipeSnapshotJson: "{}",
                    compiledRequestsJson: JSON.stringify([{garbage: true}]),
                    outputCount: 1,
                    additionalCostLowerBound: null,
                    tokenLowerBound: null,
                },
            });
        } finally {
            db.$disconnect();
        }

        await expect(service.delete(projectPath, source.id)).rejects.toMatchObject({
            code: "REFERENCE_OWNER_EVIDENCE_INVALID",
        });
        await expect(service.read(projectPath, source.id)).resolves.toMatchObject({status: "available"});
    });

    it("崩溃恢复：行存在 + tombstone 存在时恢复到 verified final，随后正常删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "recover.png"});
        const content = await service.content(projectPath, source.id);
        // 模拟删除在 rename→tombstone 后、删行前崩溃：final 移到 tombstone、行还在。
        const tombstonePath = `${content.absolutePath}.${source.id}.${source.contentHash.slice(0, 16)}.delete`;
        await fs.rename(content.absolutePath, tombstonePath);

        // 下一次删除先 reconcile：tombstone 与行证据一致 → 恢复 final → 正常删除。
        await expect(service.delete(projectPath, source.id)).resolves.toBeUndefined();
        await expect(service.read(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);
        await expect(fs.stat(content.absolutePath)).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.stat(tombstonePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("崩溃恢复：tombstone 被篡改时 fail closed，不把损坏字节恢复成 final", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "tampered-tombstone.png"});
        const content = await service.content(projectPath, source.id);
        const tombstonePath = `${content.absolutePath}.${source.id}.${source.contentHash.slice(0, 16)}.delete`;
        await fs.rename(content.absolutePath, tombstonePath);
        await fs.writeFile(tombstonePath, Buffer.from("tampered-tombstone-bytes"));

        await expect(service.delete(projectPath, source.id)).rejects.toMatchObject({code: "REFERENCE_ASSET_TAMPERED"});
        // 行与 tombstone 都保持原样，绝不猜测。
        await expect(service.read(projectPath, source.id)).resolves.toMatchObject({status: "missing"});
        await expect(fs.readFile(tombstonePath, "utf8")).resolves.toBe("tampered-tombstone-bytes");
    });

    it("崩溃恢复：行不存在 + tombstone 存在时删除 tombstone，不恢复已提交删除", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "removed-row.png"});
        const content = await service.content(projectPath, source.id);
        const tombstonePath = `${content.absolutePath}.${source.id}.${source.contentHash.slice(0, 16)}.delete`;
        await fs.rename(content.absolutePath, tombstonePath);
        // 手动删行，模拟删除在行删除后、tombstone 清理前崩溃。
        const db = await openProjectDatabase(projectPath);
        try {
            await db.textToImageReferenceAsset.delete({where: {id: source.id}});
        } finally {
            db.$disconnect();
        }

        // 删除其它资产触发 reconcile：行不在 + tombstone 在 → 清理 tombstone。
        const otherBytes = await createImage("png", "#112233");
        const other = await service.upload({projectPath, bytes: otherBytes, fileName: "other.png"});
        await service.delete(projectPath, other.id);
        await expect(fs.stat(tombstonePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("未识别 tombstone（命名不符）不被恢复也不被清理", async () => {
        const bytes = await createImage("png");
        const source = await service.upload({projectPath, bytes, fileName: "unknown-tombstone.png"});
        const content = await service.content(projectPath, source.id);
        const unknownTombstone = `${content.absolutePath}.mystery.delete`;
        await fs.writeFile(unknownTombstone, Buffer.from("unknown"));

        const otherBytes = await createImage("png", "#445566");
        const other = await service.upload({projectPath, bytes: otherBytes, fileName: "other.png"});
        await service.delete(projectPath, other.id);

        await expect(fs.readFile(unknownTombstone, "utf8")).resolves.toBe("unknown");
    });
});

async function createImage(format: "png" | "jpeg", background = "#4d65ff"): Promise<Buffer> {
    const image = sharp({
        create: {width: 3, height: 2, channels: 4, background},
    });
    return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

async function publishedFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory()) {
            files.push(...await publishedFiles(path.join(root, entry.name)));
        } else if (entry.isFile()
            && entry.name !== ".mutation-lock-target"
            && !entry.name.endsWith(".tmp")
            && !entry.name.endsWith(".delete")) {
            files.push(path.join(root, entry.name));
        }
    }
    return files;
}

async function resolveProjectFilePath(projectPath: string, relativePath: string): Promise<string> {
    const {resolveProjectAbsolutePath} = await import("nbook/server/text-to-image/compat");
    return path.join(resolveProjectAbsolutePath(projectPath), relativePath);
}

async function referenceRoot(projectPath: string): Promise<string> {
    const {resolveProjectAbsolutePath} = await import("nbook/server/text-to-image/compat");
    return path.join(resolveProjectAbsolutePath(projectPath), ".nbook", "text-to-image", "references");
}

async function openProjectDatabase(projectPath: string): Promise<import("nbook/server/generated/project-prisma/client").PrismaClient> {
    const {textToImageProjectClient} = await import("nbook/server/text-to-image/project-client");
    return await textToImageProjectClient(projectPath);
}

/** 写入引用指定 contentHash 的 Project Recipe（frontmatter 真相源）。 */
async function writeRecipeWithVibeReference(projectPath: string, contentHash: string): Promise<void> {
    const {createDefaultTextToImageRecipeSource} = await import("nbook/shared/text-to-image-recipe");
    const {renderTextToImageRecipeMarkdown} = await import("nbook/server/text-to-image/recipe.codec");
    const source = createDefaultTextToImageRecipeSource();
    const withRef = {
        ...source,
        references: {
            ...source.references,
            vibeReferences: [{contentHash, strength: 0.6, informationExtracted: 0.7}],
        },
    };
    const root = await resolveProjectFilePath(projectPath, ".");
    const recipePath = path.join(root, "lorebook", "instruction", "text-to-image", "default", "index.md");
    await fs.mkdir(path.dirname(recipePath), {recursive: true});
    await fs.writeFile(recipePath, renderTextToImageRecipeMarkdown(withRef));
}
