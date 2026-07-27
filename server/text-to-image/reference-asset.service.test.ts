import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
    TextToImageReferenceAssetService,
} from "nbook/server/text-to-image/reference-asset.service";
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

    it("内容寻址上传：相同 bytes 复用同一资产，文件与 DB 成对维护", async () => {
        const bytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]);
        const first = await service.upload({
            projectPath, bytes, mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        const second = await service.upload({
            projectPath, bytes, mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        expect(second.id).toBe(first.id);
        expect(second.contentHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(second.relativePath).toBe(`assets/text-to-image/references/${first.contentHash.slice(0, 2)}/${first.contentHash}.png`);

        const content = await service.content(projectPath, first.id);
        expect(content.mimeType).toBe("image/png");
        expect(await fs.readFile(content.absolutePath)).toEqual(Buffer.from(bytes));
    });

    it("同内容同 kind 复用资产；inpaint 蒙版用途由 Recipe slot 决定", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const first = await service.upload({
            projectPath, bytes, mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        const reused = await service.upload({
            projectPath, bytes, mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        expect(reused.id).toBe(first.id);
    });

    it("source-image 拒绝不受支持的 MIME", async () => {
        await expect(service.upload({
            projectPath, bytes: new Uint8Array([1]), mimeType: "image/gif", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        })).rejects.toThrow(/不支持 MIME/);
    });

    it("vibe-encoding 必须三字段齐全；非派生不得携带派生字段", async () => {
        const bytes = new Uint8Array([10, 20, 30]);
        await expect(service.upload({
            projectPath, bytes, mimeType: "application/octet-stream", kind: "vibe-encoding",
            parentAssetId: null, derivedModel: "nai-diffusion-4-5-full", derivedInfoExtracted: 0.7,
        })).rejects.toThrow(/vibe-encoding 必须同时提供/);

        await expect(service.upload({
            projectPath, bytes, mimeType: "image/png", kind: "source-image",
            parentAssetId: "asset-x", derivedModel: null, derivedInfoExtracted: null,
        })).rejects.toThrow(/不得携带派生字段/);
    });

    it("Vibe encoding 缓存查询：按源资产+model+infoExtracted 命中", async () => {
        const source = await service.upload({
            projectPath, bytes: new Uint8Array([5, 6, 7, 8]), mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        const encoding = await service.upload({
            projectPath, bytes: new Uint8Array([100, 101, 102]), mimeType: "application/octet-stream", kind: "vibe-encoding",
            parentAssetId: source.id, derivedModel: "nai-diffusion-4-5-full", derivedInfoExtracted: 0.7,
        });

        const hit = await service.findVibeEncoding({
            projectPath, sourceAssetId: source.id, model: "nai-diffusion-4-5-full", infoExtracted: 0.7,
        });
        expect(hit?.id).toBe(encoding.id);

        const miss = await service.findVibeEncoding({
            projectPath, sourceAssetId: source.id, model: "nai-diffusion-4-5-full", infoExtracted: 0.5,
        });
        expect(miss).toBeNull();
    });

    it("按 contentHash 批量复验引用闭合", async () => {
        const a = await service.upload({
            projectPath, bytes: new Uint8Array([1, 1]), mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        const map = await service.readByContentHashes(projectPath, [a.contentHash, "0".repeat(64)]);
        expect(map.get(a.contentHash)?.id).toBe(a.id);
        expect(map.has("0".repeat(64))).toBe(false);
    });

    it("删除源资产时若有派生 encoding 引用则拒绝", async () => {
        const source = await service.upload({
            projectPath, bytes: new Uint8Array([9, 9]), mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        await service.upload({
            projectPath, bytes: new Uint8Array([1, 2]), mimeType: "application/octet-stream", kind: "vibe-encoding",
            parentAssetId: source.id, derivedModel: "nai-diffusion-4-5-full", derivedInfoExtracted: 0.7,
        });
        await expect(service.delete(projectPath, source.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetInUseError);
    });

    it("删除派生 encoding 不受源引用阻止，且文件与 DB 成对清理", async () => {
        const source = await service.upload({
            projectPath, bytes: new Uint8Array([9, 9]), mimeType: "image/png", kind: "source-image",
            parentAssetId: null, derivedModel: null, derivedInfoExtracted: null,
        });
        const encoding = await service.upload({
            projectPath, bytes: new Uint8Array([1, 2]), mimeType: "application/octet-stream", kind: "vibe-encoding",
            parentAssetId: source.id, derivedModel: "nai-diffusion-4-5-full", derivedInfoExtracted: 0.7,
        });
        await service.delete(projectPath, encoding.id);
        await expect(service.read(projectPath, encoding.id)).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);
    });

    it("读取不存在的资产抛稳定错误", async () => {
        await expect(service.read(projectPath, randomUUID())).rejects.toBeInstanceOf(TextToImageReferenceAssetNotFoundError);
    });
});
