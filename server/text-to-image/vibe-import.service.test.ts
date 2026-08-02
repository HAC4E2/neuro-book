import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {VibeImportService} from "nbook/server/text-to-image/vibe-import.service";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {buildVibeContainerFixture, vendorEncodingId} from "nbook/server/text-to-image/vibe-container.test-fixture";
import {parseVibeContainer} from "nbook/server/text-to-image/vibe-container.parser";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {resolveProjectAbsolutePath, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

describe("VibeImportService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let service: VibeImportService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/vibe-import-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath), {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(textToImageProjectRef(projectPath).projectRoot);
        service = new VibeImportService();
    });

    afterEach(async () => {
        await closeProjectForTest(textToImageProjectRef(projectPath).projectRoot).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("all-or-nothing 导入 source + 全部 encoding，typed lineage provenance=naiv4vibe-import", async () => {
        const bytes = await buildVibeContainerFixture({encodingCount: 2});
        const response = await service.importContainer({projectPath, bytes});

        expect(response.encodingCount).toBe(2);
        expect(response.sourceAlreadyExists).toBe(false);
        expect(response.sourceMimeType).toBe("image/jpeg");
        expect(response.providerModel).toBe("nai-diffusion-4-5-full");
        expect(response.encoderVersion).toBe("novelai-vibe/v4-5full/v1");
        expect(response.displayName).toBe("合成 Vibe");
        expect(response.hasThumbnail).toBe(true);

        const db = await textToImageProjectClient(projectPath);
        const lineages = await db.textToImageVibeEncoding.findMany({
            include: {blob: true, source: true},
            orderBy: {canonicalInformation: "asc"},
        });
        expect(lineages).toHaveLength(2);
        for (const lineage of lineages) {
            expect(lineage.provenance).toBe("naiv4vibe-import");
            expect(lineage.encoderVersion).toBe("novelai-vibe/v4-5full/v1");
            expect(lineage.source.contentHash).toBe(response.sourceContentHash);
            expect(lineage.blob.contentHash).toBe(lineage.encodingContentHash);
            const absolutePath = path.join(resolveProjectAbsolutePath(projectPath), lineage.blob.relativePath);
            await expect(fs.stat(absolutePath)).resolves.toMatchObject({size: lineage.blob.byteLength});
        }

        // findVibeEncoding 能命中导入的 cache。
        const referenceService = new TextToImageReferenceAssetService();
        const first = lineages[0]!;
        await expect(referenceService.findVibeEncoding({
            projectPath,
            sourceContentHash: first.sourceContentHash,
            model: first.providerModel,
            informationExtracted: first.informationExtracted,
        })).resolves.toEqual(await fs.readFile(path.join(
            resolveProjectAbsolutePath(projectPath),
            first.blob.relativePath,
        )));
    });

    it("重放相同容器幂等：返回相同 lineage 与 source，不重复写文件", async () => {
        const bytes = await buildVibeContainerFixture({encodingCount: 2});
        const first = await service.importContainer({projectPath, bytes});
        const second = await service.importContainer({projectPath, bytes});

        expect(second.sourceContentHash).toBe(first.sourceContentHash);
        expect(second.sourceAlreadyExists).toBe(true);
        expect(second.encodingCount).toBe(first.encodingCount);

        const db = await textToImageProjectClient(projectPath);
        expect(await db.textToImageVibeEncoding.count()).toBe(2);
        expect(await db.textToImageVibeEncodingBlob.count()).toBe(2);
        const files = await collectReferenceFiles();
        expect(files).toHaveLength(3); // source + 2 blobs，无 temp 残留
    });

    it("非法容器在发布任何记录前整体拒绝", async () => {
        const bad = await buildVibeContainerFixture({encodingCount: 0});
        await expect(service.importContainer({projectPath, bytes: bad})).rejects.toMatchObject({
            code: "VIBE_CONTAINER_ENCODING_INVALID",
        });
        const db = await textToImageProjectClient(projectPath);
        expect(await db.textToImageReferenceAsset.count()).toBe(0);
        expect(await db.textToImageVibeEncoding.count()).toBe(0);
    });

    it("解析结果与导入响应一致（containerContentHash / suggestedStrength）", async () => {
        const bytes = await buildVibeContainerFixture({encodingCount: 3});
        const parsed = await parseVibeContainer(bytes);
        const response = await service.importContainer({projectPath, bytes});

        expect(response.containerContentHash).toBe(parsed.containerContentHash);
        expect(response.suggestedStrength).toBe(parsed.suggestedStrength);
        expect(response.sourceWidth).toBe(parsed.source.evidence.width);
        expect(response.sourceHeight).toBe(parsed.source.evidence.height);
    });

    async function collectReferenceFiles(): Promise<string[]> {
        const root = path.join(resolveProjectAbsolutePath(projectPath), ".nbook", "text-to-image", "references");
        const files: string[] = [];
        const walk = async (directory: string): Promise<void> => {
            const entries = await fs.readdir(directory, {withFileTypes: true});
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    await walk(path.join(directory, entry.name));
                } else if (entry.isFile()
                    && entry.name !== ".mutation-lock-target"
                    && !entry.name.endsWith(".tmp")
                    && !entry.name.endsWith(".delete")) {
                    files.push(path.join(directory, entry.name));
                }
            }
        };
        await walk(root);
        return files;
    }
});
