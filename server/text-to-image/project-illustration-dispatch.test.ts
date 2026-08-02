import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {ProviderLaneItemSnapshot} from "nbook/shared/text-to-image-dispatch";
import {
    createIllustrationCompiledRequestHash,
    createIllustrationExecutionManifestHash,
    type IllustrationCompiledRequest,
} from "nbook/shared/text-to-image-execution";
import {
    IllustrationExecutionRepository,
    prepareIllustrationExecutionRegistration,
    type PreparedIllustrationRegistration,
} from "nbook/server/text-to-image/execution.repository";
import {illustrationCompiledRequestFixture, illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";
import {
    NovelAiHttpError,
    type CompiledNovelAiReferenceResolver,
} from "nbook/server/text-to-image/novelai-image-generation";
import {
    ProjectIllustrationDispatch,
    type ProjectResultWriteInput,
} from "nbook/server/text-to-image/project-illustration-dispatch";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

// register 锁内重读由真实锁覆盖；这里仅把 scope 断言替换为 no-op，锁本体保留真实文件锁。
vi.mock("nbook/server/text-to-image/reference-asset-lock", async (importOriginal) => {
    const actual = await importOriginal<typeof import("nbook/server/text-to-image/reference-asset-lock")>();
    return {
        ...actual,
        assertTextToImageReferenceMutationScope: (): void => undefined,
    };
});

/** 固定 1x1 透明 PNG（含 IHDR/IDAT/IEND），sharp 可完整解码。 */
function createTinyPng(): Buffer {
    return Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
    );
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

describe("ProjectIllustrationDispatch", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let prisma: PrismaClient;
    let projection: PreparedIllustrationRegistration;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-illustration-dispatch-"));
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: root});
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        prisma = new PrismaClient({adapter});
        projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(1));
        await new IllustrationExecutionRepository(prisma).register(projection, {
            preparationId: projection.preparationId,
            prepareAttemptId: "prepare-attempt-1",
            prepareLeaseUntil: "2099-07-21T00:00:30.000Z",
            prepareVersion: 1,
        }, {} as never);
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        setWorkspaceRuntimeRootContextForTest(null);
        await prisma.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        try {
            await fs.rm(root, {recursive: true, force: true});
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) throw error;
        }
    });

    it("preflights exact Project closure and executes the strict adapter once with matching fence", async () => {
        const requestImage = vi.fn(async () => ({
            image: {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, width: 832, height: 1216, seed: 100},
            request: {model: "nai-diffusion-4-5-full", seed: 100, compiledRequestHash: projection.jobs[0]!.request.compiledRequestHash},
        }));
        const writeResult = vi.fn(async ({client, item}: ProjectResultWriteInput) => {
            await client.textToImageJob.update({where: {id: item.jobId}, data: {status: "succeeded", finishedAt: new Date()}});
            return "completed" as const;
        });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
            writeResult,
        });

        await expect(dispatch.preflight(item("leased"))).resolves.toEqual({kind: "valid"});
        await expect(dispatch.execute(item("attempt_started"), "captured-token")).resolves.toEqual({kind: "completed"});
        expect(requestImage).toHaveBeenCalledTimes(1);
        expect(requestImage.mock.calls[0]?.[0]).toEqual(projection.jobs[0]?.request);
        expect(requestImage.mock.calls[0]?.[1]).toBe("captured-token");
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "succeeded", activeAttemptId: "attempt-1", activeAttemptFence: 1});
        await expect(dispatch.inspectExpiredAttempt(item("attempt_started"))).resolves.toEqual({kind: "completed"});
    });

    it("executes the real default adapter binding with fetchImpl in the correct argument slot", async () => {
        // 回归：不注入 requestImage，走生产默认绑定（曾把 resolver 误传进 fetchImpl 参数位导致
        // “fetchImpl is not a function”全量 outcome_unknown）。stub 全局 fetch 返回 PNG magic bytes。
        const httpFetch = vi.fn(async () => new Response(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])));
        vi.stubGlobal("fetch", httpFetch);
        const writeResult = vi.fn(async ({client, item: laneItem}: ProjectResultWriteInput) => {
            await client.textToImageJob.update({where: {id: laneItem.jobId}, data: {status: "succeeded", finishedAt: new Date()}});
            return "completed" as const;
        });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            writeResult,
        });

        await expect(dispatch.execute(item("attempt_started"), "captured-token")).resolves.toEqual({kind: "completed"});
        expect(httpFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = httpFetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(calledUrl).toBe("https://image.novelai.net/ai/generate-image");
        expect(new Headers(calledInit.headers).get("authorization")).toBe("Bearer captured-token");
        expect(JSON.parse(String(calledInit.body)) as {model: string}).toMatchObject({model: "nai-diffusion-4-5-full"});
        expect(writeResult).toHaveBeenCalledTimes(1);
    });

    it("rejects a stale prepareVersion before start and never calls the adapter", async () => {
        await prisma.textToImageDispatchOutbox.update({
            where: {jobId: projection.jobs[0]!.id},
            data: {prepareVersion: 0},
        });
        const requestImage = vi.fn();
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
        });

        await expect(dispatch.preflight(item("leased"))).resolves.toMatchObject({
            kind: "invalid",
            code: "TEXT_TO_IMAGE_PROJECT_JOB_STALE",
        });
        expect(requestImage).not.toHaveBeenCalled();
    });

    it("persists a paid-boundary credential failure as Project configuration stale", async () => {
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
        });

        await expect(dispatch.configurationError(
            item("leased"),
            "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
            "Provider 凭据无法解密",
        )).resolves.toBeUndefined();
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({
                status: "configuration_stale",
                stableErrorCode: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
                errorMessage: "Provider 凭据无法解密",
            });
    });

    it("persists explicit HTTP failure and does not retry inside the adapter", async () => {
        const requestImage = vi.fn(async () => { throw new NovelAiHttpError(503); });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
        });

        await expect(dispatch.execute(item("attempt_started"), "captured-token")).resolves.toEqual({
            kind: "retryable",
            code: "NOVELAI_HTTP_503",
            message: "NovelAI 请求失败：503",
        });
        expect(requestImage).toHaveBeenCalledTimes(1);
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "queued", activeAttemptId: "attempt-1", activeAttemptFence: 1, stableErrorCode: "NOVELAI_HTTP_503"});
        await expect(dispatch.inspectExpiredAttempt(item("attempt_started"))).resolves.toEqual({
            kind: "retryable",
            code: "NOVELAI_HTTP_503",
            message: "NovelAI 请求失败：503",
        });

        await expect(dispatch.preflight(item("retry_leased"))).resolves.toEqual({kind: "valid"});
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "queued", activeAttemptId: null, activeAttemptFence: null, stableErrorCode: null});
    });

    it("preflight 只读元数据；resolver 字节读取只发生在 attempt_started 后的 execute", async () => {
        const {bytes} = await insertReferenceAsset();
        const contentHash = sha256Hex(bytes);
        const refProjection = await registerReferenceProjection(contentHash);
        let capturedResolver: CompiledNovelAiReferenceResolver | undefined;
        const requestImage = vi.fn(async (request: IllustrationCompiledRequest, _credential: string, _signal: AbortSignal, resolver?: CompiledNovelAiReferenceResolver) => {
            capturedResolver = resolver;
            expect(resolver).toBeDefined();
            const source = await resolver!.readSource(contentHash);
            expect(Buffer.from(source.bytes)).toEqual(bytes);
            // 未预存 encoding：cache miss，不应有错误。
            await expect(resolver!.readVibeEncoding({
                sourceContentHash: contentHash,
                providerModel: request.model,
                informationExtracted: 0.7,
                encoderVersion: "novelai-vibe/v4-5full/v1",
            })).resolves.toBeNull();
            return {
                image: {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, width: 832, height: 1216, seed: 100},
                request: {model: request.model, wireModel: request.wireModel, seed: 100, compiledRequestHash: request.compiledRequestHash},
            };
        });
        const writeResult = vi.fn(async ({client, item: laneItem}: ProjectResultWriteInput) => {
            await client.textToImageJob.update({where: {id: laneItem.jobId}, data: {status: "succeeded", finishedAt: new Date()}});
            return "completed" as const;
        });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
            writeResult,
        });

        await expect(dispatch.preflight(referenceItem(refProjection, "leased"))).resolves.toEqual({kind: "valid"});
        expect(capturedResolver).toBeUndefined();  // preflight 不构造 resolver、不读任何参考字节
        await expect(dispatch.execute(referenceItem(refProjection, "attempt_started"), "captured-token"))
            .resolves.toEqual({kind: "completed"});
        expect(capturedResolver).toBeDefined();
        expect(requestImage).toHaveBeenCalledTimes(1);
    });

    it("dispatch 把当前 ephemeral client 注入 resolver；closed-Project 下不 fallback 到 active-Project 单例", async () => {
        const {bytes} = await insertReferenceAsset();
        const contentHash = sha256Hex(bytes);
        const refProjection = await registerReferenceProjection(contentHash);
        let resolvedBytes: Uint8Array | null = null;
        const requestImage = vi.fn(async (_request: IllustrationCompiledRequest, _credential: string, _signal: AbortSignal, resolver?: CompiledNovelAiReferenceResolver) => {
            const source = await resolver!.readSource(contentHash);
            resolvedBytes = source.bytes;            return {
                image: {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const, width: 832, height: 1216, seed: 100},
                request: {model: "nai-diffusion-4-5-full", wireModel: "nai-diffusion-4-5-full", seed: 100, compiledRequestHash: refProjection.jobs[0]!.request.compiledRequestHash},
            };
        });
        const writeResult = vi.fn(async ({client, item: laneItem}: ProjectResultWriteInput) => {
            await client.textToImageJob.update({where: {id: laneItem.jobId}, data: {status: "succeeded", finishedAt: new Date()}});
            return "completed" as const;
        });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
            writeResult,
        });

        // 本测试从未 openProjectForTest：若 resolver fallback 到 active-Project 单例
        // （textToImageProjectClient → requireReadyProjectPath），readSource 会直接抛错。
        await expect(dispatch.execute(referenceItem(refProjection, "attempt_started"), "captured-token"))
            .resolves.toEqual({kind: "completed"});
        expect(Buffer.from(resolvedBytes ?? new Uint8Array())).toEqual(bytes);
    });

    it("授权后参考文件被篡改：stable non-retryable reference failure，且零远端调用", async () => {
        const {absolutePath} = await insertReferenceAsset();
        const refProjection = await registerReferenceProjection(sha256Hex(createTinyPng()));
        // 模拟授权后文件被替换为不可解码字节：stat/完整复验都会失败。
        await fs.writeFile(absolutePath, Buffer.from("tampered-bytes"));
        const httpFetch = vi.fn();
        vi.stubGlobal("fetch", httpFetch);
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
        });

        await expect(dispatch.execute(referenceItem(refProjection, "attempt_started"), "captured-token"))
            .resolves.toMatchObject({kind: "failed", code: "REFERENCE_ASSET_TAMPERED"});
        expect(httpFetch).not.toHaveBeenCalled();
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: refProjection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "failed", stableErrorCode: "REFERENCE_ASSET_TAMPERED"});
    });

    it("网络/超时歧义仍然 yield outcome_unknown 且不自动重试", async () => {
        const requestImage = vi.fn(async () => { throw new Error("socket reset"); });
        const dispatch = new ProjectIllustrationDispatch({
            runProject: async (_projectPath, operation) => await operation(prisma),
            requestImage,
        });

        await expect(dispatch.execute(item("attempt_started"), "captured-token"))
            .resolves.toEqual({kind: "outcome_unknown", message: "socket reset"});
        await expect(prisma.textToImageJob.findUniqueOrThrow({where: {id: projection.jobs[0]!.id}}))
            .resolves.toMatchObject({status: "outcome_unknown", stableErrorCode: "TEXT_TO_IMAGE_OUTCOME_UNKNOWN"});
        expect(requestImage).toHaveBeenCalledTimes(1);
    });

    function item(state: "leased" | "retry_leased" | "attempt_started"): ProviderLaneItemSnapshot {
        const job = projection.jobs[0]!;
        const started = state === "attempt_started";
        const retry = state === "retry_leased";
        return {
            schemaVersion: "nbook.text-to-image-provider-lane-item/v1",
            dispatchKey: job.dispatchKey,
            preparationId: projection.preparationId,
            jobId: job.id,
            ownerUserId: 7,
            providerId: 11,
            providerCredentialRevision: 3,
            projectId: "project-1",
            projectPath: "workspace/demo",
            manifestHash: projection.input.executionManifestHash,
            prepareAttemptId: "prepare-attempt-1",
            prepareVersion: 1,
            state,
            stateVersion: retry ? 6 : started ? 4 : 3,
            claimId: "claim-1",
            claimLeaseUntil: "2099-07-21T00:00:30.000Z",
            sendAttemptId: started || retry ? "attempt-1" : null,
            sendLeaseUntil: started || retry ? "2099-07-21T00:02:00.000Z" : null,
            sendFence: started || retry ? 1 : null,
            attemptCount: started || retry ? 1 : 0,
            errorCode: retry ? "NOVELAI_HTTP_503" : null,
            errorMessage: retry ? "NovelAI 请求失败：503" : null,
            createdAt: "2026-07-21T00:00:00.000Z",
            updatedAt: "2026-07-21T00:00:00.000Z",
        };
    }

    /** 构造带 Vibe reference 的 registration 并注册到当前 Project DB。 */
    async function registerReferenceProjection(contentHash: string): Promise<PreparedIllustrationRegistration> {
        const fixture = illustrationRegistrationFixture(1);
        const {compiledRequestHash: _omit, ...base} = illustrationCompiledRequestFixture(0);
        const requestBase = {
            ...base,
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash, strength: 0.6, informationExtracted: 0.7}],
                characterReferences: [],
                inpaint: null,
            },
        };
        const compiledRequests: IllustrationCompiledRequest[] = [{
            ...requestBase,
            compiledRequestHash: createIllustrationCompiledRequestHash(requestBase),
        }];
        const executionManifestHash = createIllustrationExecutionManifestHash({
            executionInputHashes: fixture.executionInputHashes,
            recipeSnapshot: fixture.compiledRequests[0]!.recipeSnapshot,
            compiledRequests,
            outputCount: fixture.outputCount,
            additionalCostLowerBound: fixture.additionalCostLowerBound,
            tokenLowerBound: fixture.tokenLowerBound,
        });
        const refProjection = prepareIllustrationExecutionRegistration({
            ...fixture,
            compiledRequests,
            executionManifestHash,
        });
        await new IllustrationExecutionRepository(prisma).register(refProjection, {
            preparationId: refProjection.preparationId,
            prepareAttemptId: "prepare-ref-1",
            prepareLeaseUntil: "2099-07-21T00:00:30.000Z",
            prepareVersion: 1,
        }, {} as never);
        return refProjection;
    }

    /** 在 workspace root 下的真实引用目录写入可解码 PNG，并登记 source 行。 */
    async function insertReferenceAsset(): Promise<{absolutePath: string; bytes: Buffer}> {
        const bytes = createTinyPng();
        const contentHash = sha256Hex(bytes);
        const relativePath = `.nbook/text-to-image/references/${contentHash.slice(0, 2)}/${contentHash}.png`;
        const absolutePath = path.join(root, "demo", relativePath);
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, bytes);
        await prisma.textToImageReferenceAsset.create({
            data: {
                id: contentHash,
                contentHash,
                relativePath,
                fileName: "vibe-source.png",
                mimeType: "image/png",
                byteLength: bytes.byteLength,
                width: 1,
                height: 1,
            },
        });
        return {absolutePath, bytes};
    }

    /** 带 Vibe reference 的 lane item；manifest/job/preparation 都来自 refProjection。 */
    function referenceItem(refProjection: PreparedIllustrationRegistration, state: "leased" | "attempt_started"): ProviderLaneItemSnapshot {
        const job = refProjection.jobs[0]!;
        const started = state === "attempt_started";
        return {
            schemaVersion: "nbook.text-to-image-provider-lane-item/v1",
            dispatchKey: job.dispatchKey,
            preparationId: refProjection.preparationId,
            jobId: job.id,
            ownerUserId: 7,
            providerId: 11,
            providerCredentialRevision: 3,
            projectId: "project-1",
            projectPath: "workspace/demo",
            manifestHash: refProjection.input.executionManifestHash,
            prepareAttemptId: "prepare-ref-1",
            prepareVersion: 1,
            state,
            stateVersion: started ? 4 : 3,
            claimId: "claim-1",
            claimLeaseUntil: "2099-07-21T00:00:30.000Z",
            sendAttemptId: started ? "attempt-1" : null,
            sendLeaseUntil: started ? "2099-07-21T00:02:00.000Z" : null,
            sendFence: started ? 1 : null,
            attemptCount: started ? 1 : 0,
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-07-21T00:00:00.000Z",
            updatedAt: "2026-07-21T00:00:00.000Z",
        };
    }
});
