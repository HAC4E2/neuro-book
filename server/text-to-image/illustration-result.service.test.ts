import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    createIllustrationCompiledRequestHash,
    createTextToImageJobSourceIdentityHash,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {renderTextToImagePromptMarkdown} from "nbook/shared/text-to-image-markdown";
import {resolveProviderCapability} from "nbook/shared/text-to-image-provider-registry";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import {IllustrationResultService} from "nbook/server/text-to-image/illustration-result.service";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {resetWorkspaceHistoryForTest} from "nbook/server/workspace-history/project-history";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;
const CHAPTER_PATH = "manuscript/v1/c1/index.md";
const PLACEHOLDER_ID = "placeholder-1";
const JOB_ID = "job-1";
const ASSET_ID = "asset-1";

describe("IllustrationResultService", () => {
    let workspaceAssets: IsolatedWorkspaceAssets;
    let projectPath: string;
    let chapterFile: string;
    let request: IllustrationCompiledRequest;
    let service: IllustrationResultService;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        workspaceAssets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/illustration-result-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "插图结果测试", summary: ""});
        chapterFile = path.join(resolveProjectAbsolutePath(projectPath), ...CHAPTER_PATH.split("/"));
        await fs.mkdir(path.dirname(chapterFile), {recursive: true});
        // restore 漂移预检比对真实语义 hash：占位块是 managed block 不进 hash，先解析一次即可回填。
        const realChapterHash = new IllustrationChapterParser()
            .parse({chapterPath: CHAPTER_PATH, markdown: chapterMarkdown(compiledRequest())})
            .sourceChapterHash;
        request = compiledRequest(realChapterHash);
        await fs.writeFile(chapterFile, chapterMarkdown(request), "utf8");
        await openProjectForTest(projectPath);
        await createJobAndAsset(projectPath, request);
        service = new IllustrationResultService();
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        await workspaceAssets.dispose();
    });

    it("replaces the exact V2 placeholder and preserves unrelated manual/external images", async () => {
        const result = await service.applyAssetResult(resultInput(projectPath));

        expect(result.status).toBe("inserted");
        const markdown = await fs.readFile(chapterFile, "utf8");
        expect(markdown).not.toContain(`<text-to-image-prompt id="${PLACEHOLDER_ID}">`);
        expect(markdown).toContain("![NovelAI 生成图片](assets/text-to-image/2026/07/asset-1.png");
        expect(markdown).toContain("![手工图](assets/manual.png)");
        expect(markdown).toContain("![外链](https://example.com/image.png)");
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            status: "succeeded",
            sourceInsertStatus: "inserted",
            resultAssetIdsJson: JSON.stringify([ASSET_ID]),
        });
    });

    it.each([
        ["shotIntentHash", {...requestSource(), shotIntentHash: H("9")}],
        ["superseded shot", {...requestSource(), shotId: "shot-new", shotOrigin: "selection" as const}],
    ])("keeps asset history but rejects a same-ID %s mismatch as late", async (_label, source) => {
        await fs.writeFile(chapterFile, chapterMarkdown({...request, source}), "utf8");

        const result = await service.applyAssetResult(resultInput(projectPath));

        expect(result.status).toBe("late");
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toContain(`<text-to-image-prompt id="${PLACEHOLDER_ID}">`);
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageAsset.count({where: {id: ASSET_ID}})).resolves.toBe(1);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            status: "succeeded",
            sourceInsertStatus: "missing",
            stableErrorCode: "ILLUSTRATION_PLACEHOLDER_STALE",
        });
    });

    it("marks a removed placeholder missing without appending the result elsewhere", async () => {
        await fs.writeFile(chapterFile, "正文。\n\n![手工图](assets/manual.png)", "utf8");

        const result = await service.applyAssetResult(resultInput(projectPath));

        expect(result.status).toBe("missing");
        const markdown = await fs.readFile(chapterFile, "utf8");
        expect(markdown).toBe("正文。\n\n![手工图](assets/manual.png)");
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            status: "succeeded",
            sourceInsertStatus: "missing",
        });
    });

    it("drops a mismatched send attempt fence as late without changing chapter or Job", async () => {
        const before = await fs.readFile(chapterFile, "utf8");

        const result = await service.applyAssetResult({
            ...resultInput(projectPath),
            attemptFence: {attemptId: "attempt-old", fencingVersion: 3},
        });

        expect(result.status).toBe("late");
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toBe(before);
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            status: "completing",
            sourceInsertStatus: "pending",
        });
    });

    it("returns the same inserted result when completion is delivered twice", async () => {
        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});

        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});
        const markdown = await fs.readFile(chapterFile, "utf8");
        expect(markdown.match(/!\[NovelAI 生成图片\]/gu)).toHaveLength(1);
    });

    it("restores the inserted canonical markdown back to the exact V2 placeholder for reroll", async () => {
        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});

        const receipt = await service.restoreAssetPlaceholder({projectPath, ownerUserId: 7, jobId: JOB_ID, assetId: ASSET_ID});

        expect(receipt.status).toBe("restored");
        const markdown = await fs.readFile(chapterFile, "utf8");
        expect(markdown).toContain(`<text-to-image-prompt id="${PLACEHOLDER_ID}">`);
        expect(markdown).not.toContain("![NovelAI 生成图片]");
        expect(markdown).toContain("![手工图](assets/manual.png)");
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            status: "succeeded",
            sourceInsertStatus: "missing",
        });
        await expect(client.textToImageAsset.count({where: {id: ASSET_ID}})).resolves.toBe(1);
    });

    it("refuses to restore after the chapter body was edited and keeps the inserted image", async () => {
        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});
        const inserted = await fs.readFile(chapterFile, "utf8");
        await fs.writeFile(chapterFile, inserted.replace("正文。", "正文已被作者继续修改。"), "utf8");
        const edited = await fs.readFile(chapterFile, "utf8");

        await expect(service.restoreAssetPlaceholder({projectPath, ownerUserId: 7, jobId: JOB_ID, assetId: ASSET_ID}))
            .rejects.toThrow("正文在插图生成后已被编辑");
        await expect(fs.readFile(chapterFile, "utf8")).resolves.toBe(edited);
        const client = await textToImageProjectClient(projectPath);
        await expect(client.textToImageJob.findUnique({where: {id: JOB_ID}})).resolves.toMatchObject({
            sourceInsertStatus: "inserted",
        });
    });

    it("reports missing asset markdown without writing when the image was manually deleted", async () => {
        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});
        const inserted = await fs.readFile(chapterFile, "utf8");
        // 删除整条 canonical 图片 Markdown：owned 图片本就不进语义 hash，预检通过后命中 missing 出口。
        const renderedLine = inserted.split("\n").find((line) => line.startsWith("![NovelAI 生成图片]"))!;
        await fs.writeFile(chapterFile, inserted.replace(`${renderedLine}`, "").replace("\n\n\n", "\n\n"), "utf8");

        const receipt = await service.restoreAssetPlaceholder({projectPath, ownerUserId: 7, jobId: JOB_ID, assetId: ASSET_ID});

        expect(receipt.status).toBe("asset_markdown_missing");
    });

    it("rejects a restore request from a different owner", async () => {
        await expect(service.applyAssetResult(resultInput(projectPath))).resolves.toMatchObject({status: "inserted"});

        await expect(service.restoreAssetPlaceholder({projectPath, ownerUserId: 8, jobId: JOB_ID, assetId: ASSET_ID}))
            .rejects.toThrow("Job 不属于当前用户");
    });
});

/** 创建一个处于 completing 且已绑定 send fence 的 Route B Job/Asset。 */
async function createJobAndAsset(projectPath: string, request: IllustrationCompiledRequest): Promise<void> {
    const client = await textToImageProjectClient(projectPath);
    await client.textToImageJob.create({
        data: {
            id: JOB_ID,
            providerId: request.provider.providerId,
            kind: "illustration",
            status: "completing",
            sourcePath: request.source.chapterPath,
            sourceAnchorId: request.source.placeholderId,
            sourceInsertStatus: "pending",
            providerSnapshotJson: JSON.stringify(request.provider),
            requestJson: JSON.stringify(request),
            originJson: JSON.stringify({
                kind: "button",
                chapterPath: request.source.chapterPath,
                placeholderId: request.source.placeholderId,
                shotId: request.source.shotId,
                shotOrigin: request.source.shotOrigin,
            }),
            sourceIdentityHash: createTextToImageJobSourceIdentityHash({
                kind: "button",
                chapterPath: request.source.chapterPath,
                placeholderId: request.source.placeholderId,
                shotId: request.source.shotId,
                shotOrigin: request.source.shotOrigin,
            }),
            providerOwnerUserId: request.provider.ownerUserId,
            providerCredentialRevision: request.provider.credentialRevision,
            compiledRequestHash: request.compiledRequestHash,
            idempotencyKey: H("9"),
            variantIndex: 0,
            outputIndex: 0,
            activeAttemptId: "attempt-1",
            activeAttemptFence: 4,
            resultAssetIdsJson: "[]",
        },
    });
    await client.textToImageAsset.create({
        data: {
            id: ASSET_ID,
            jobId: JOB_ID,
            relativePath: "assets/text-to-image/2026/07/asset-1.png",
            fileName: "asset-1.png",
            mimeType: "image/png",
            byteLength: 3,
            width: 832,
            height: 1216,
            model: request.model,
            seed: request.parameters.seed,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            sourceKind: "illustration",
            sourcePath: request.source.chapterPath,
            sourceAnchorId: request.source.placeholderId,
        },
    });
}

/** Result service 的严格 attempt fence 输入。 */
function resultInput(projectPath: string) {
    return {
        projectPath,
        jobId: JOB_ID,
        assetId: ASSET_ID,
        attemptFence: {attemptId: "attempt-1", fencingVersion: 4},
    };
}

/** 带无关图片的章节 fixture。 */
function chapterMarkdown(request: IllustrationCompiledRequest): string {
    return [
        "正文。",
        "",
        renderTextToImagePromptMarkdown({
            id: request.source.placeholderId,
            schema: "nbook.text-to-image-prompt/v2",
            shotId: request.source.shotId,
            shotIntentHash: request.source.shotIntentHash,
            sourceChapterHash: request.source.sourceChapterHash,
            anchorId: request.source.anchorId,
            origin: request.source.shotOrigin,
        }),
        "",
        "![手工图](assets/manual.png)",
        "",
        "![外链](https://example.com/image.png)",
    ].join("\n");
}

/** CompiledRequest source fixture。 */
function requestSource(sourceChapterHash: string = H("b")) {
    return {
        projectId: "project-1",
        chapterPath: CHAPTER_PATH,
        placeholderId: PLACEHOLDER_ID,
        shotId: "shot-1",
        shotOrigin: "chapter-plan" as const,
        shotIntentHash: H("a"),
        sourceChapterHash,
        anchorId: "p_0001_abcdef12",
    };
}

/** 自校验的最小 immutable CompiledRequest fixture。 */
function compiledRequest(sourceChapterHash: string = H("b")): IllustrationCompiledRequest {
    const recipeSnapshot = createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
    const base = {
        schemaVersion: "nbook.illustration-compiled-request/v1" as const,
        compilerVersion: "route-b-compiler-v1",
        executionPolicyVersion: "route-b-execution-v1",
        providerKind: "novelai" as const,
        source: requestSource(sourceChapterHash),
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        capabilitySnapshot: resolveProviderCapability({kind: "novelai-model" as const, modelId: "nai-diffusion-4-5-full" as const}),
        model: "nai-diffusion-4-5-full" as const,
        action: "generate" as const,
        prompt: "rain",
        negativePrompt: "lowres",
        characterPrompts: [],
        parameters: {
            sampler: "k_euler_ancestral",
            noiseSchedule: "karras",
            steps: 28,
            promptGuidance: 5,
            promptGuidanceRescale: 0,
            width: 832,
            height: 1216,
            seed: 123,
            count: 1 as const,
            aiDefaultCharacterPosition: true,
            variety: false,
            smeaMode: "auto" as const,
            smeaDyn: false,
            decrisper: false,
            qualityToggle: true,
            ucPreset: 4,
        },
        recipeSnapshot,
        references: {normalizeVibeStrengths: true, vibeReferences: [], characterReferences: [], inpaint: null},
        expansion: {
            patternSnapshots: [],
            characterSnapshots: [],
            resolutionValidationHash: H("e"),
            positive: [],
            negative: [],
            characters: [],
        },
    };
    return {...base, compiledRequestHash: createIllustrationCompiledRequestHash(base)};
}
