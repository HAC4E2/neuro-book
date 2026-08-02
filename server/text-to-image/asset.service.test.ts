import {createHash, randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {resolveProjectAbsolutePath, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";

describe("TextToImageAssetService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let service: TextToImageAssetService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/text-to-image-assets-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath), {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(textToImageProjectRef(projectPath).projectRoot);
        service = new TextToImageAssetService();
    });

    afterEach(async () => {
        await closeProjectForTest(textToImageProjectRef(projectPath).projectRoot).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("原子保存图片、按创建时间倒序分页，并可读取受控内容路径", async () => {
        const jobId = await createJob(projectPath);
        const first = await service.save({
            projectPath,
            jobId,
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad anatomy",
            sourceKind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "paragraph-1",
        });
        const second = await service.save({
            projectPath,
            jobId,
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 43,
            prompt: "1girl, sunset",
            negativePrompt: "bad anatomy",
            sourceKind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "paragraph-2",
        });

        expect((await service.list({projectPath, pageSize: 1})).items.map((asset) => asset.id)).toEqual([second.id]);
        const content = await service.content(projectPath, first.id);
        expect(content.mimeType).toBe("image/png");
        expect(await fs.readFile(content.absolutePath)).toEqual(Buffer.from([137, 80, 78, 71]));
    });

    it("当正文仍引用图片时拒绝删除", async () => {
        const asset = await service.save({
            projectPath,
            jobId: await createJob(projectPath),
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad anatomy",
            sourceKind: "manual",
            sourcePath: null,
            sourceAnchorId: null,
        });
        const chapterPath = path.join(resolveProjectAbsolutePath(projectPath), "manuscript", "chapter-1.md");
        await fs.mkdir(path.dirname(chapterPath), {recursive: true});
        await fs.writeFile(chapterPath, `![](${asset.relativePath})`, "utf8");

        await expect(service.delete(projectPath, asset.id)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_ASSET_REFERENCED"});
    });

    it("可以按关联任务状态筛选历史资产", async () => {
        const jobId = await createJob(projectPath);
        const asset = await service.save({
            projectPath,
            jobId,
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 44,
            prompt: "retry scene",
            negativePrompt: "",
            sourceKind: "manual",
            sourcePath: null,
            sourceAnchorId: null,
        });
        await (await textToImageProjectClient(projectPath)).textToImageJob.update({
            where: {id: jobId},
            data: {status: "failed"},
        });

        await expect(service.list({projectPath, jobStatus: "failed"})).resolves.toMatchObject({
            items: [{id: asset.id, jobStatus: "failed"}],
        });
        await expect(service.list({projectPath, jobStatus: "succeeded"})).resolves.toMatchObject({items: []});
    });

    it("save 计算并登记 contentHash；手工资产 compiled 证据保持 null", async () => {
        const asset = await service.save({
            projectPath,
            jobId: await createJob(projectPath),
            bytes: new Uint8Array([137, 80, 78, 71]),
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad anatomy",
            sourceKind: "manual",
            sourcePath: null,
            sourceAnchorId: null,
        });
        const db = await textToImageProjectClient(projectPath);
        try {
            const row = await db.textToImageAsset.findUniqueOrThrow({where: {id: asset.id}});
            expect(row.contentHash).toBe(createHash("sha256").update(new Uint8Array([137, 80, 78, 71])).digest("hex"));
            expect(row.compiledRequestHash).toBeNull();
            expect(row.compiledRevision).toBeNull();
        } finally {
            db.$disconnect();
        }
    });

    it("strict 资产（Route-B illustration）登记编译请求证据；content 复验哈希", async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const asset = await service.save({
            projectPath,
            jobId: await createJob(projectPath),
            bytes,
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad anatomy",
            sourceKind: "illustration",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "placeholder-1",
            compiledRequestHash: "compiled-request-hash-1",
            compiledRevision: "route-b-compiler-v1",
        });
        const db = await textToImageProjectClient(projectPath);
        try {
            const row = await db.textToImageAsset.findUniqueOrThrow({where: {id: asset.id}});
            expect(row.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
            expect(row.compiledRequestHash).toBe("compiled-request-hash-1");
            expect(row.compiledRevision).toBe("route-b-compiler-v1");
        } finally {
            db.$disconnect();
        }
        // content 完整复验 contentHash：篡改文件后 fail closed。
        const content = await service.content(projectPath, asset.id);
        await fs.writeFile(content.absolutePath, Buffer.from("tampered"));
        await expect(service.content(projectPath, asset.id)).rejects.toThrow("完整性校验失败");
    });

    it("被 promotion 引用的生成资产拒绝删除（稳定 owner 错误）", async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const asset = await service.save({
            projectPath,
            jobId: await createJob(projectPath),
            bytes,
            mimeType: "image/png",
            width: 512,
            height: 768,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "",
            sourceKind: "illustration",
            sourcePath: null,
            sourceAnchorId: null,
        });
        const db = await textToImageProjectClient(projectPath);
        try {
            // promotion 的 reference 行必须存在（Restrict FK）。
            const referenceHash = "a".repeat(64);
            await db.textToImageReferenceAsset.create({
                data: {
                    id: referenceHash,
                    contentHash: referenceHash,
                    relativePath: `.nbook/text-to-image/references/aa/${referenceHash}.png`,
                    fileName: "ref.png",
                    mimeType: "image/png",
                    byteLength: 4,
                    width: 1,
                    height: 1,
                },
            });
            await db.textToImageReferencePromotion.create({
                data: {
                    id: randomUUID(),
                    generatedAssetId: asset.id,
                    generatedAssetContentHash: createHash("sha256").update(bytes).digest("hex"),
                    referenceContentHash: referenceHash,
                    sourceKind: "generated-asset",
                    sourceId: asset.id,
                },
            });
        } finally {
            db.$disconnect();
        }

        await expect(service.delete(projectPath, asset.id)).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_GENERATED_ASSET_PROMOTED",
        });
        await expect(service.read(projectPath, asset.id)).resolves.toMatchObject({id: asset.id});
    });
});

async function createJob(projectPath: string): Promise<string> {
    const id = randomUUID();
    await (await textToImageProjectClient(projectPath)).textToImageJob.create({
        data: {
            id,
            providerId: 1,
            kind: "manual",
            status: "queued",
            sourceInsertStatus: "not_applicable",
            requestJson: "{}",
            resultAssetIdsJson: "[]",
        },
    });
    return id;
}
