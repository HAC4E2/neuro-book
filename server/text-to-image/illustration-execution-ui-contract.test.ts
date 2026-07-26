import fs from "node:fs/promises";
import {describe, expect, it, vi} from "vitest";
import {
    IllustrationPlaceholderStatusSchema,
    type IllustrationExecutionPreview,
} from "nbook/shared/text-to-image-execution-ui";
import {
    buildIllustrationBatchGenerateBody,
    buildIllustrationGenerateBody,
} from "nbook/app/utils/illustration-execution-ui";
import {resolveApiErrorCode} from "nbook/app/utils/api-error";
import {
    IllustrationPlaceholderStatusService,
    type IllustrationPlaceholderJobSnapshot,
} from "nbook/server/text-to-image/illustration-placeholder.service";
import {IllustrationExecutionCompilerError} from "nbook/server/text-to-image/illustration-execution.compiler";

const H = (digit: string): string => `sha256:${digit.repeat(64)}`;

describe("server-owned illustration placeholder state", () => {
    it("returns ready only after the current published target is validated", async () => {
        const readSourceIdentity = vi.fn(async () => H("1"));
        const service = new IllustrationPlaceholderStatusService({
            readLatestJob: async () => null,
            readSourceIdentity,
        });

        const result = await service.read({projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-1"});

        expect(result).toMatchObject({
            schemaVersion: "nbook.illustration-placeholder-status/v1",
            placeholderId: "placeholder-1",
            status: "ready",
            sourceIdentityHash: H("1"),
            job: null,
        });
        expect(readSourceIdentity).toHaveBeenCalledOnce();
        expect(result.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it.each([
        ["queued", "pending", "queued"],
        ["running", "pending", "running"],
        ["completing", "pending", "running"],
        ["configuration_stale", "pending", "stale"],
        ["outcome_unknown", "pending", "outcome_unknown"],
        ["succeeded", "pending", "running"],
    ] as const)("maps persisted Job %s/%s to %s without compiling", async (jobStatus, sourceInsertStatus, expectedStatus) => {
        const readSourceIdentity = vi.fn(async () => H("1"));
        const service = new IllustrationPlaceholderStatusService({
            readLatestJob: async () => jobFixture({status: jobStatus, sourceInsertStatus}),
            readSourceIdentity,
        });

        const result = await service.read({projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-1"});

        expect(result.status).toBe(expectedStatus);
        expect(result.job?.status).toBe(jobStatus);
        expect(readSourceIdentity).not.toHaveBeenCalled();
    });

    // 重roll合同（2026-07-27）：无计费不确定性的终态（failed/canceled/interrupted/succeeded+missing）
    // 不再永久锁死占位块，改为重新校验当前发布 target 后放行 ready；
    // outcome_unknown 与 configuration_stale 仍保持上面的冻结投影。
    it.each([
        ["failed", "pending"],
        ["canceled", "pending"],
        ["interrupted", "pending"],
        ["succeeded", "missing"],
    ] as const)("re-validates the published target after terminal %s/%s and returns ready", async (jobStatus, sourceInsertStatus) => {
        const readSourceIdentity = vi.fn(async () => H("1"));
        const service = new IllustrationPlaceholderStatusService({
            readLatestJob: async () => jobFixture({status: jobStatus, sourceInsertStatus}),
            readSourceIdentity,
        });

        const result = await service.read({projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-1"});

        expect(result.status).toBe("ready");
        expect(result.job).toBeNull();
        expect(readSourceIdentity).toHaveBeenCalledOnce();
    });

    it("projects a structurally invalid published target as stable stale state", async () => {
        const service = new IllustrationPlaceholderStatusService({
            readLatestJob: async () => null,
            readSourceIdentity: async () => {
                throw new IllustrationExecutionCompilerError("ILLUSTRATION_EXECUTION_TARGET_INVALID", "shot drift");
            },
        });

        const result = await service.read({projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-1"});

        expect(result).toMatchObject({
            status: "stale",
            sourceIdentityHash: null,
            errorCode: "ILLUSTRATION_PLACEHOLDER_STALE",
        });
        expect(() => IllustrationPlaceholderStatusSchema.parse({...result, prompt: "must-not-leak"})).toThrow();
    });
});

describe("illustration execution UI request ownership", () => {
    it("prefers the stable h3 business code over a generic fetch error code", () => {
        expect(resolveApiErrorCode({
            code: "FETCH_ERROR",
            data: {data: {code: "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED"}},
        })).toBe("ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED");
    });

    it("builds exact single and batch authorization bodies from a server preview", () => {
        const preview = previewFixture();

        expect(buildIllustrationGenerateBody("workspace/demo", preview)).toEqual({
            projectPath: "workspace/demo",
            previewToken: "signed-token",
            manifestHash: H("4"),
            authorization: {
                authorizedOutputCount: 1,
                authorizedCostLimit: null,
                authorizedTokenLimit: null,
            },
        });
        expect(buildIllustrationBatchGenerateBody("workspace/demo", ["placeholder-1"], preview)).toEqual({
            projectPath: "workspace/demo",
            placeholderIds: ["placeholder-1"],
            previewToken: "signed-token",
            manifestHash: H("4"),
            authorization: {
                authorizedOutputCount: 1,
                authorizedCostLimit: null,
                authorizedTokenLimit: null,
            },
        });
    });

    it("keeps NodeView lazy and batch confirmation single-shot without local execution truth", async () => {
        const [nodeView, controller, panel] = await Promise.all([
            fs.readFile("app/components/markdown-studio/tiptap/TextToImagePrompt.ts", "utf8"),
            fs.readFile("app/composables/useIllustrationExecutionController.ts", "utf8"),
            fs.readFile("app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue", "utf8"),
        ]);

        expect(nodeView).toContain("IntersectionObserver");
        expect(nodeView).toContain("controller.resolve");
        expect(nodeView).not.toContain("new Map");
        expect(controller).toContain("/status");
        expect(controller).toContain("/execution-preview");
        expect(controller).toContain("/generate");
        expect(controller).not.toContain("localStorage");
        expect(panel).toContain("/prompt-placeholders/execution-preview-batch");
        expect(panel).toContain("/prompt-placeholders/generate-batch");
        expect(panel).toContain("dialog.confirm");
    });
});

/** 构造 status service 的最小持久 Job 投影。 */
function jobFixture(input: Pick<IllustrationPlaceholderJobSnapshot, "status" | "sourceInsertStatus">): IllustrationPlaceholderJobSnapshot {
    return {
        id: "job-1",
        status: input.status,
        sourceInsertStatus: input.sourceInsertStatus,
        stableErrorCode: null,
        errorMessage: null,
        updatedAt: "2026-07-21T00:00:00.000Z",
    };
}

/** 构造不含完整 Prompt 的最小服务端 Preview DTO。 */
function previewFixture(): IllustrationExecutionPreview {
    return {
        schemaVersion: "nbook.illustration-execution-preview/v1",
        kind: "single",
        previewToken: "signed-token",
        expiresAt: Date.now() + 60_000,
        targetHash: H("2"),
        executionInputHashes: [H("3")],
        manifestHash: H("4"),
        outputCount: 1,
        recipe: {recipeId: "default", title: "默认配方", recipeSourceHash: "5".repeat(64)},
        provider: {ownerUserId: 7, providerId: 11, credentialRevision: 3},
        requests: [{
            source: {
                projectId: "project-1",
                chapterPath: "manuscript/v1/c1/index.md",
                placeholderId: "placeholder-1",
                shotId: "shot-1",
                shotOrigin: "chapter-plan",
                anchorId: "p_0001_abcdef12",
                shotIntentHash: H("6"),
                sourceChapterHash: H("7"),
            },
            sourceIdentityHash: H("1"),
            model: "nai-diffusion-4-5-full",
            width: 832,
            height: 1216,
            seed: 123,
            compiledRequestHash: H("8"),
            advanced: {
                aiDefaultCharacterPosition: true,
                variety: false,
                smeaMode: "auto",
                smeaDyn: false,
                decrisper: false,
            },
            references: {
                vibeCount: 0,
                characterCount: 0,
                hasInpaint: false,
            },
        }],
        knownCost: null,
        tokenLowerBound: null,
        warnings: [],
    };
}
