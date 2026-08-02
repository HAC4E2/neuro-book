import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    canonicalizeInformationExtracted,
    FrozenReferenceAssetSchema,
    hashVibeEncodingCacheKey,
    type FrozenReferenceAsset,
} from "nbook/shared/text-to-image-reference-asset";
import {
    TextToImageReferenceAssetNotFoundError,
} from "nbook/server/text-to-image/reference-asset.service";
import {
    TextToImageVibeEncodingService,
} from "nbook/server/text-to-image/vibe-encoding.service";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";

const MODEL = "nai-diffusion-4-5-full" as const;
const ENCODER = "novelai-vibe/v4-5full/v1" as const;

describe("TextToImageVibeEncodingService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let service: TextToImageVibeEncodingService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/vibe-encoding-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(projectPath);
        service = new TextToImageVibeEncodingService();
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    async function storeSource(): Promise<FrozenReferenceAsset> {
        const bytes = await createImage("png");
        const {TextToImageReferenceAssetService} = await import("nbook/server/text-to-image/reference-asset.service");
        const dto = await new TextToImageReferenceAssetService().upload({projectPath, bytes, fileName: "vibe-source.png"});
        return FrozenReferenceAssetSchema.parse({
            contentHash: dto.contentHash,
            kind: "source-image",
            mimeType: dto.mimeType,
            byteLength: dto.byteLength,
            width: dto.width,
            height: dto.height,
        });
    }

    it("storeRemoteVibeEncoding 后 readVibeEncoding 按完整 key 命中并返回同一字节", async () => {
        const source = await storeSource();
        const encodingBytes = new Uint8Array([9, 8, 7, 6, 5]);

        await service.storeRemoteVibeEncoding({
            projectPath,
            source,
            providerModel: MODEL,
            informationExtracted: 0.7,
            encoderVersion: ENCODER,
            bytes: encodingBytes,
        });

        await expect(service.readVibeEncoding({
            projectPath,
            sourceContentHash: source.contentHash,
            providerModel: MODEL,
            informationExtracted: 0.7,
            encoderVersion: ENCODER,
        })).resolves.toEqual(Buffer.from(encodingBytes));
    });

    it("同 key 重放幂等；source/model/info/encoder-version 任何一项不同都是另一个 cache key", async () => {
        const source = await storeSource();
        const encodingBytes = new Uint8Array([1, 2, 3]);

        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: encodingBytes,
        });
        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: encodingBytes,
        });

        // 相同 key 命中；不同 informationExtracted / source 都是 miss。
        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).resolves.toEqual(Buffer.from(encodingBytes));
        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: MODEL, informationExtracted: 0.5, encoderVersion: ENCODER,
        })).resolves.toBeNull();
        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: "f".repeat(64), providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).resolves.toBeNull();
        // 没有登记 Vibe 容器配对的 model 一律 fail closed，绝不静默当成 miss。
        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: "nai-diffusion-4-5-curated" as const, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).rejects.toThrow();
    });

    it("不同 cache key 的相同 encoding 字节共享同一内容寻址 blob", async () => {
        const source = await storeSource();
        const encodingBytes = new Uint8Array([0xaa, 0xbb]);

        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: encodingBytes,
        });
        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.5, encoderVersion: ENCODER, bytes: encodingBytes,
        });

        // 两个 lineage 指向同一 blob；blob 文件只落一份。
        const db = await openProjectDatabase(projectPath);
        try {
            const lineages = await db.textToImageVibeEncoding.findMany({include: {blob: true}});
            expect(lineages).toHaveLength(2);
            expect(new Set(lineages.map((lineage) => lineage.blob.contentHash))).toHaveLength(1);
        } finally {
            db.$disconnect();
        }
        const root = path.join(await resolveProjectRoot(projectPath), ".nbook", "text-to-image", "references");
        expect(await publishedBlobFiles(root)).toHaveLength(1);
    });

    it("source evidence 与登记的 source 行不一致时 fail closed，不写任何 lineage", async () => {
        const source = await storeSource();
        const bogus: FrozenReferenceAsset = {...source, contentHash: "b".repeat(64)};

        await expect(service.storeRemoteVibeEncoding({
            projectPath,
            source: bogus,
            providerModel: MODEL,
            informationExtracted: 0.7,
            encoderVersion: ENCODER,
            bytes: new Uint8Array([1]),
        })).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);

        const db = await openProjectDatabase(projectPath);
        try {
            expect(await db.textToImageVibeEncoding.count()).toBe(0);
            expect(await db.textToImageVibeEncodingBlob.count()).toBe(0);
        } finally {
            db.$disconnect();
        }
    });

    it("blob 文件被篡改（hash/长度不符）时 readVibeEncoding fail closed", async () => {
        const source = await storeSource();
        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: new Uint8Array([1, 2, 3]),
        });

        const db = await openProjectDatabase(projectPath);
        let absolutePath = "";
        try {
            const blob = await db.textToImageVibeEncodingBlob.findFirstOrThrow();
            const {resolveProjectAbsolutePath} = await import("nbook/server/text-to-image/compat");
            const {resolveReferenceAssetPath} = await import("nbook/server/text-to-image/asset-path");
            absolutePath = resolveReferenceAssetPath(await resolveProjectAbsolutePath(projectPath), blob.relativePath);
        } finally {
            db.$disconnect();
        }
        await fs.writeFile(absolutePath, Buffer.from("tampered-encoding-bytes"));

        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);
    });

    it("lineage 行字段与完整 key 不一致时 fail closed，而不是返回错误字节", async () => {
        const source = await storeSource();
        const realBytes = new Uint8Array([0x11, 0x22]);
        await service.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: realBytes,
        });

        // 直接损坏 lineage 的 providerModel，使其与自己的 cache key id 语义不一致。
        const db = await openProjectDatabase(projectPath);
        try {
            const lineageId = hashVibeEncodingCacheKey({
                providerKind: "novelai",
                sourceContentHash: source.contentHash,
                providerModel: MODEL,
                canonicalInformation: canonicalizeInformationExtracted(0.7),
                encoderVersion: ENCODER,
            });
            await db.textToImageVibeEncoding.update({
                where: {id: lineageId},
                data: {providerModel: "nai-diffusion-4-5-curated"},
            });
        } finally {
            db.$disconnect();
        }

        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).rejects.toThrow();
    });

    it("没有登记 Vibe 容器配对的 model 拒绝读写", async () => {
        const source = await storeSource();
        await expect(service.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: "nai-diffusion-4-5-curated" as const, informationExtracted: 0.7, encoderVersion: ENCODER,
        })).rejects.toThrow();
    });

    it("注入的 client factory 被用于所有 DB 访问（不依赖 active-Project 单例）", async () => {
        const source = await storeSource();
        const calls: string[] = [];
        const injected = new TextToImageVibeEncodingService(async () => {
            calls.push("injected-client");
            const {textToImageProjectClient} = await import("nbook/server/text-to-image/project-client");
            return await textToImageProjectClient(projectPath);
        });

        await injected.storeRemoteVibeEncoding({
            projectPath, source, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER, bytes: new Uint8Array([7, 7]),
        });
        await injected.readVibeEncoding({
            projectPath, sourceContentHash: source.contentHash, providerModel: MODEL, informationExtracted: 0.7, encoderVersion: ENCODER,
        });

        expect(calls.length).toBeGreaterThanOrEqual(2);
    });
});

async function createImage(format: "png" | "jpeg", background = "#4d65ff"): Promise<Buffer> {
    const image = sharp({
        create: {width: 3, height: 2, channels: 4, background},
    });
    return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

async function publishedBlobFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory()) {
            files.push(...await publishedBlobFiles(path.join(root, entry.name)));
        } else if (entry.isFile()
            && entry.name.endsWith(".bin")
            && !entry.name.endsWith(".tmp")
            && !entry.name.endsWith(".delete")) {
            files.push(path.join(root, entry.name));
        }
    }
    return files;
}

async function resolveProjectRoot(projectPath: string): Promise<string> {
    const {resolveProjectAbsolutePath} = await import("nbook/server/text-to-image/compat");
    return await resolveProjectAbsolutePath(projectPath);
}

async function openProjectDatabase(projectPath: string): Promise<import("nbook/server/generated/project-prisma/client").PrismaClient> {
    const {textToImageProjectClient} = await import("nbook/server/text-to-image/project-client");
    return await textToImageProjectClient(projectPath);
}

// 避免未使用导入告警；hash 与 canonical 在损坏测试中直接消费。
void createHash;
