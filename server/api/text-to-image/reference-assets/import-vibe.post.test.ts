import {randomUUID} from "node:crypto";
import {PassThrough, Readable} from "node:stream";
import type {IncomingMessage} from "node:http";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {VibeImportResponse} from "nbook/shared/text-to-image-vibe-container";
import {buildVibeContainerFixture} from "nbook/server/text-to-image/vibe-container.test-fixture";

type ImportService = (input: {projectPath: string; bytes: Uint8Array}) => Promise<VibeImportResponse>;

describe("POST /api/text-to-image/reference-assets/import-vibe", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("严格 query + 单个 file part 上传，忽略扩展名解析", async () => {
        const debugFs = await import("node:fs/promises");
        await debugFs.appendFile("C:/Users/admir/Desktop/Pi/neuro-book/.agent/hang3.log", "before-fixture\n", "utf8");
        const bytes = await buildVibeContainerFixture();
        await debugFs.appendFile("C:/Users/admir/Desktop/Pi/neuro-book/.agent/hang3.log", "after-fixture\n", "utf8");
        const response = importResponse(bytes);
        const importContainer = vi.fn<ImportService>(async () => response);
        installMocks({importContainer});
        const boundary = "nbook-vibe-boundary";
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "sample.naiv4vibe",
            mimeType: "application/octet-stream",
            data: bytes,
        }])], {"content-type": `multipart/form-data; boundary=${boundary}`});

        const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;
        await debugFs.appendFile("C:/Users/admir/Desktop/Pi/neuro-book/.agent/hang3.log", "calling\n", "utf8");
        const outcome = await Promise.race([
            handler({node: {req: request}} as never).then((v) => ({v})),
            new Promise((resolve) => setTimeout(() => resolve({timeout: true}), 8000)),
        ]);
        await debugFs.appendFile("C:/Users/admir/Desktop/Pi/neuro-book/.agent/hang3.log", "outcome: " + JSON.stringify(outcome) + "\n", "utf8");
        expect(outcome).toEqual({v: response});
        const [calledInput] = importContainer.mock.calls[0]!;
        expect(calledInput.projectPath).toBe("workspace/demo");
        expect(Buffer.from(calledInput.bytes)).toEqual(Buffer.from(bytes));
    }, 30_000);

    it("拒绝多余 query 键、额外字段和空文件", async () => {
        const bytes = await buildVibeContainerFixture();
        const invalidCases: Array<{
            query?: Record<string, string>;
            parts?: Array<{name: string; filename?: string; mimeType?: string; data: Buffer}>;
        }> = [
            {query: {projectPath: "workspace/demo", kind: "vibe"}, parts: [{name: "file", filename: "a.vibe", mimeType: "application/octet-stream", data: bytes}]},
            {query: {projectPath: "workspace/demo"}, parts: [
                {name: "file", filename: "a.vibe", mimeType: "application/octet-stream", data: bytes},
                {name: "note", data: Buffer.from("extra")},
            ]},
            {query: {projectPath: "workspace/demo"}, parts: [
                {name: "file", filename: "empty.vibe", mimeType: "application/octet-stream", data: Buffer.alloc(0)},
            ]},
        ];
        for (const [index, testCase] of invalidCases.entries()) {
            vi.resetModules();
            const importContainer = vi.fn<ImportService>();
            installMocks({importContainer, getQuery: testCase.query ?? {projectPath: "workspace/demo"}});
            const boundary = `nbook-${index}-${randomUUID()}`;
            const request = incomingRequest([multipartBody(boundary, testCase.parts ?? [])], {
                "content-type": `multipart/form-data; boundary=${boundary}`,
            });
            const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;

            await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({statusCode: 400});
            expect(importContainer).not.toHaveBeenCalled();
        }
    }, 30_000);

    it("query 缺 projectPath 时在消费 multipart body 前拒绝", async () => {
        const importContainer = vi.fn<ImportService>();
        installMocks({importContainer, getQuery: {kind: "vibe"}});
        const request = incomingRequest([], {
            "content-type": "multipart/form-data; boundary=unused",
            "content-length": "1024",
        });
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
        expect(pipe).not.toHaveBeenCalled();
        expect(importContainer).not.toHaveBeenCalled();
    });

    it("Content-Length 明确超限时在读取 multipart 前拒绝", async () => {
        const importContainer = vi.fn<ImportService>();
        installMocks({importContainer});
        const request = incomingRequest([], {
            "content-type": "multipart/form-data; boundary=unused",
            "content-length": String(34 * 1024 * 1024),
        });
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 413,
            data: {code: "VIBE_CONTAINER_TOO_LARGE"},
        });
        expect(pipe).not.toHaveBeenCalled();
        expect(importContainer).not.toHaveBeenCalled();
    });

    it("解析失败（非法容器）通过共享 mapper 映射为 422", async () => {
        const bytes = await buildVibeContainerFixture({encodingCount: 0});
        const importContainer = vi.fn<ImportService>(async () => {
            const {VibeContainerError} = await import("nbook/server/text-to-image/vibe-container.parser");
            throw new VibeContainerError("VIBE_CONTAINER_ENCODING_INVALID", "invalid");
        });
        installMocks({importContainer});
        const boundary = "nbook-bad-vibe";
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "bad.vibe",
            mimeType: "application/octet-stream",
            data: bytes,
        }])], {"content-type": `multipart/form-data; boundary=${boundary}`});
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 422,
            data: {code: "VIBE_CONTAINER_ENCODING_INVALID"},
        });
    });

    it("上传流中止时返回 400 且不调用 service", async () => {
        const importContainer = vi.fn<ImportService>();
        installMocks({importContainer});
        const boundary = "nbook-vibe-aborted";
        const transport = new PassThrough();
        const request = Object.assign(transport, {
            headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
        }) as IncomingMessage;
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/import-vibe.post")).default;
        const response = handler({node: {req: request}} as never);
        await new Promise<void>((resolve) => setImmediate(resolve));
        transport.write(multipartBody(boundary, [{
            name: "file",
            filename: "partial.vibe",
            mimeType: "application/octet-stream",
            data: Buffer.alloc(64, 1),
        }]).subarray(0, 80));
        request.emit("aborted");

        await expect(response).rejects.toMatchObject({statusCode: 400});
        expect(importContainer).not.toHaveBeenCalled();
    });
});

/** 安装路由 seam；multipart 本身不 mock，必须经过真实 busboy。 */
function installMocks(options: {
    getQuery?: Record<string, string>;
    importContainer: ImportService;
}): void {
    vi.doMock("h3", async (importOriginal) => ({
        ...(await importOriginal<typeof import("h3")>()),
        getRequestHeader: (event: {node: {req: IncomingMessage}}, name: string) => event.node.req.headers[name.toLowerCase()],
        getQuery: () => options.getQuery ?? {projectPath: "workspace/demo"},
    }));
    vi.doMock("nbook/server/utils/auth", () => ({
        requireCurrentUser: vi.fn(async () => {}),
    }));
    vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
        withProjectNotOpenHttpError: async (run: () => Promise<unknown>) => run(),
    }));
    vi.doMock("nbook/server/text-to-image/vibe-import.service", () => ({
        VibeImportService: class {
            importContainer = options.importContainer;
        },
    }));
}

/** 构造支持 pipe 的 IncomingMessage 测试替身，并保留真实 chunk 边界。 */
function incomingRequest(chunks: Buffer[], headers: IncomingMessage["headers"]): IncomingMessage {
    return Object.assign(Readable.from(chunks), {headers}) as IncomingMessage;
}

/** 生成最小合法 multipart body；二进制 data 不做字符串往返。 */
function multipartBody(boundary: string, parts: Array<{name: string; filename?: string; mimeType?: string; data: Buffer}>): Buffer {
    const chunks: Buffer[] = [];
    for (const part of parts) {
        const disposition = part.filename
            ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
            : `Content-Disposition: form-data; name="${part.name}"\r\n`;
        chunks.push(Buffer.from(`--${boundary}\r\n${disposition}${part.mimeType ? `Content-Type: ${part.mimeType}\r\n` : ""}\r\n`, "utf8"));
        chunks.push(part.data, Buffer.from("\r\n", "utf8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
    return Buffer.concat(chunks);
}

function importResponse(bytes: Buffer): VibeImportResponse {
    return {
        schemaVersion: "nbook.vibe-import-response/v1",
        containerContentHash: "a".repeat(64),
        sourceContentHash: "b".repeat(64),
        sourceMimeType: "image/jpeg",
        sourceWidth: 3,
        sourceHeight: 2,
        providerModel: "nai-diffusion-4-5-full",
        encoderVersion: "novelai-vibe/v4-5full/v1",
        suggestedStrength: 0.3,
        encodingCount: 2,
        displayName: "sample",
        displayCreatedAt: null,
        hasThumbnail: false,
        sourceAlreadyExists: false,
    };
}
