import {PassThrough, Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";
import {randomUUID} from "node:crypto";
import type {IncomingMessage} from "node:http";

type UploadService = (input: {
    projectPath: string;
    bytes: Uint8Array;
    fileName?: string;
}) => Promise<TextToImageReferenceAssetDto>;

describe("repro-api-dir", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("严格 query 的 projectPath + 单个 file part 上传，并把客户端文件名作为展示 hint", async () => {
        const bytes = pngBytes();
        const dto = sourceDto(bytes);
        const upload = vi.fn<UploadService>(async () => dto);
        installMocks({
            getQuery: {projectPath: "workspace/demo"},
            upload,
        });
        const boundary = "nbook-ref-boundary";
        const body = multipartBody(boundary, [{name: "file", filename: "vibe.png", mimeType: "image/png", data: bytes}]);
        const request = incomingRequest([body], {"content-type": `multipart/form-data; boundary=${boundary}`});
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;
        const result = await handler({node: {req: request}} as never);
        expect(result).toEqual(dto);
        expect(upload).toHaveBeenCalledWith({projectPath: "workspace/demo", bytes, fileName: "vibe.png"});
    }, 10000);

    it("拒绝多余 query 键、额外字段、第二文件和空文件", async () => {
        const invalidCases: Array<{
            query?: Record<string, string>;
            parts?: Array<{name: string; filename?: string; mimeType?: string; data: Buffer}>;
        }> = [
            {query: {projectPath: "workspace/demo", kind: "source-image"}, parts: [{name: "file", filename: "a.png", mimeType: "image/png", data: pngBytes()}]},
            {query: {projectPath: "workspace/demo"}, parts: [
                {name: "file", filename: "a.png", mimeType: "image/png", data: pngBytes()},
                {name: "note", data: Buffer.from("extra")},
            ]},
            {query: {projectPath: "workspace/demo"}, parts: [
                {name: "file", filename: "a.png", mimeType: "image/png", data: pngBytes()},
                {name: "second", filename: "b.png", mimeType: "image/png", data: pngBytes()},
            ]},
            {query: {projectPath: "workspace/demo"}, parts: [
                {name: "file", filename: "empty.png", mimeType: "image/png", data: Buffer.alloc(0)},
            ]},
            {query: {}, parts: [{name: "file", filename: "a.png", mimeType: "image/png", data: pngBytes()}]},
        ];
        for (const [index, testCase] of invalidCases.entries()) {
            vi.resetModules();
            const upload = vi.fn<UploadService>();
            installMocks({getQuery: testCase.query ?? {}, upload});
            const boundary = `nbook-${index}-${randomUUID()}`;
            const request = incomingRequest([multipartBody(boundary, testCase.parts ?? [])], {
                "content-type": `multipart/form-data; boundary=${boundary}`,
            });
            const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;

            await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({statusCode: 400});
            expect(upload).not.toHaveBeenCalled();
        }
    });

    it("query 缺 projectPath 时在消费 multipart body 前拒绝", async () => {
        const upload = vi.fn<UploadService>();
        installMocks({getQuery: {kind: "source-image"}, upload});
        const request = incomingRequest([], {
            "content-type": "multipart/form-data; boundary=unused",
            "content-length": "2048",
        });
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
        expect(pipe).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });

    it("Content-Length 明确超限时在读取 multipart 前拒绝", async () => {
        const upload = vi.fn<UploadService>();
        installMocks({getQuery: {projectPath: "workspace/demo"}, upload});
        const request = incomingRequest([], {
            "content-type": "multipart/form-data; boundary=unused",
            "content-length": "22020097",
        });
        const pipe = vi.spyOn(request, "pipe");
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 413,
            data: {code: "REFERENCE_IMAGE_TOO_LARGE"},
        });
        expect(pipe).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
    });

    it("缺失 multipart boundary 时保持稳定错误码", async () => {
        const upload = vi.fn<UploadService>();
        installMocks({getQuery: {projectPath: "workspace/demo"}, upload});
        const request = incomingRequest([], {"content-type": "multipart/form-data"});
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_REFERENCE_ASSET_MULTIPART"},
        });
        expect(upload).not.toHaveBeenCalled();
    });

    it("service 校验失败（非图片字节）通过共享 mapper 映射", async () => {
        const upload = vi.fn<UploadService>(async () => {
            const {TextToImageReferenceImageError} = await import("nbook/server/text-to-image/reference-image");
            throw new TextToImageReferenceImageError("REFERENCE_IMAGE_UNSUPPORTED", "not an image");
        });
        installMocks({getQuery: {projectPath: "workspace/demo"}, upload});
        const boundary = "nbook-bad-image";
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "bad.png",
            mimeType: "image/png",
            data: Buffer.from("not-an-image"),
        }])], {"content-type": `multipart/form-data; boundary=${boundary}`});
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;

        await expect(handler({node: {req: request}} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "REFERENCE_IMAGE_UNSUPPORTED"},
        });
    });

    it("上传流中止时返回 400 且不调用 service", async () => {
        const upload = vi.fn<UploadService>();
        installMocks({getQuery: {projectPath: "workspace/demo"}, upload});
        const boundary = "nbook-ref-aborted";
        const transport = new PassThrough();
        const request = Object.assign(transport, {
            headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
        }) as IncomingMessage;
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.post")).default;
        const response = handler({node: {req: request}} as never);
        await new Promise<void>((resolve) => setImmediate(resolve));
        transport.write(multipartBody(boundary, [{
            name: "file",
            filename: "partial.png",
            mimeType: "image/png",
            data: Buffer.alloc(64, 1),
        }]).subarray(0, 80));
        request.emit("aborted");

        await expect(response).rejects.toMatchObject({statusCode: 400});
        expect(upload).not.toHaveBeenCalled();
    });
});

function incomingRequest(chunks: Buffer[], headers: Record<string, string>): unknown {
    return Object.assign(Readable.from(chunks), {headers}) as never;
}

/** 安装路由 seam；multipart 本身不 mock，必须经过真实 busboy。 */
function installMocks(options: {
    getQuery: Record<string, string>;
    upload: UploadService;
}): void {
    vi.doMock("h3", async (importOriginal) => ({
        ...(await importOriginal<typeof import("h3")>()),
        getRequestHeader: (event: {node: {req: IncomingMessage}}, name: string) => event.node.req.headers[name.toLowerCase()],
        getQuery: () => options.getQuery,
    }));
    vi.doMock("nbook/server/utils/auth", () => ({
        requireCurrentUser: vi.fn(async () => {}),
    }));
    vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
        withProjectNotOpenHttpError: async (run: () => Promise<unknown>) => run(),
    }));
    vi.doMock("nbook/server/text-to-image/reference-asset.service", () => ({
        TextToImageReferenceAssetService: class {
            upload = options.upload;
        },
    }));
}

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

function pngBytes(): Buffer {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
}

function sourceDto(bytes: Buffer): TextToImageReferenceAssetDto {
    const contentHash = "a".repeat(64);
    return {
        id: contentHash,
        kind: "source-image",
        contentHash,
        fileName: "vibe.png",
        mimeType: "image/png",
        byteLength: bytes.byteLength,
        width: 3,
        height: 2,
        status: "available",
        createdAt: "2026-08-01T00:00:00.000Z",
    };
}
