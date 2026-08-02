import {PassThrough} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
} from "nbook/server/text-to-image/reference-asset.service";

type ServiceStub = {
    list: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    content: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

const serviceStub = vi.hoisted((): ServiceStub => ({
    list: vi.fn(),
    read: vi.fn(),
    content: vi.fn(),
    delete: vi.fn(),
}));

describe("reference-assets API contract", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("list 路由把严格 query 交给 service，并返回严格 page DTO", async () => {
        const dto = sourceDto();
        serviceStub.list.mockResolvedValue({
            items: [dto],
            page: 1,
            pageSize: 20,
            hasMore: false,
        });
        installMocks({
            getQuery: {projectPath: "workspace/demo", page: "1", pageSize: "20"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.get")).default;

        await expect(handler({} as never)).resolves.toEqual({
            items: [dto],
            page: 1,
            pageSize: 20,
            hasMore: false,
        });
        expect(serviceStub.list).toHaveBeenCalledWith({projectPath: "workspace/demo", page: 1, pageSize: 20});
    });

    it("list 路由拒绝非数字 page/pageSize", async () => {
        installMocks({
            getQuery: {projectPath: "workspace/demo", page: "abc", pageSize: "-1"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/index.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
        });
        expect(serviceStub.list).not.toHaveBeenCalled();
    });

    it("read 路由按 id + projectPath 读取元数据", async () => {
        const dto = sourceDto();
        serviceStub.read.mockResolvedValue(dto);
        installMocks({
            getRouterParam: dto.id,
            getQuery: {projectPath: "workspace/demo"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].get")).default;

        await expect(handler({} as never)).resolves.toEqual(dto);
        expect(serviceStub.read).toHaveBeenCalledWith("workspace/demo", dto.id);
    });

    it("read 路由 NotFound 通过共享 mapper 映射为 404", async () => {
        const {TextToImageReferenceAssetNotFoundError} = await import(
            "nbook/server/text-to-image/reference-asset.service"
        );
        serviceStub.read.mockRejectedValue(new TextToImageReferenceAssetNotFoundError("a".repeat(64)));
        installMocks({
            getRouterParam: "a".repeat(64),
            getQuery: {projectPath: "workspace/demo"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 404,
            data: {code: "TEXT_TO_IMAGE_REFERENCE_ASSET_NOT_FOUND"},
        });
    });

    it("content 路由在完整校验成功后流式返回文件", async () => {
        const dto = sourceDto();
        const absolutePath = tempFile();
        const headers: Array<[string, string]> = [];
        serviceStub.content.mockResolvedValue({
            absolutePath,
            mimeType: "image/png",
            byteLength: 12,
        });
        installMocks({
            getRouterParam: dto.id,
            getQuery: {projectPath: "workspace/demo"},
            setResponseHeader: (_event: unknown, name: string, value: string) => {
                headers.push([name, value]);
            },
            sendStream: (_event: unknown, stream: unknown) => stream,
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].content.get")).default;

        const stream = await handler({} as never);
        expect(stream).toBeInstanceOf(PassThrough);
        expect(headers).toEqual([
            ["Content-Type", "image/png"],
            ["Cache-Control", "private, max-age=60"],
        ]);
        expect(serviceStub.content).toHaveBeenCalledWith("workspace/demo", dto.id);
    });

    it("content 路由 tampered 通过共享 mapper 映射为 409", async () => {
        const {TextToImageReferenceImageError} = await import("nbook/server/text-to-image/reference-image");
        serviceStub.content.mockRejectedValue(new TextToImageReferenceImageError("REFERENCE_ASSET_TAMPERED", "tampered"));
        installMocks({
            getRouterParam: "a".repeat(64),
            getQuery: {projectPath: "workspace/demo"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].content.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "REFERENCE_ASSET_TAMPERED"},
        });
    });

    it("delete 路由接受严格 body 的 projectPath", async () => {
        serviceStub.delete.mockResolvedValue(undefined);
        installMocks({
            getRouterParam: "a".repeat(64),
            readBody: {projectPath: "workspace/demo"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].delete")).default;

        await expect(handler({} as never)).resolves.toEqual({ok: true});
        expect(serviceStub.delete).toHaveBeenCalledWith("workspace/demo", "a".repeat(64));
    });

    it("delete 路由拒绝多余 body 键和缺失 projectPath", async () => {
        for (const body of [{projectPath: "workspace/demo", kind: "source-image"}, {}]) {
            vi.resetModules();
            installMocks({
                getRouterParam: "a".repeat(64),
                readBody: body,
            });
            const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].delete")).default;

            await expect(handler({} as never)).rejects.toMatchObject({
                statusCode: 400,
                data: {code: "INVALID_REFERENCE_ASSET_INPUT"},
            });
            expect(serviceStub.delete).not.toHaveBeenCalled();
        }
    });

    it("delete 路由 InUse 通过共享 mapper 映射为 409", async () => {
        const {TextToImageReferenceAssetInUseError} = await import(
            "nbook/server/text-to-image/reference-asset.service"
        );
        serviceStub.delete.mockRejectedValue(new TextToImageReferenceAssetInUseError("a".repeat(64)));
        installMocks({
            getRouterParam: "a".repeat(64),
            readBody: {projectPath: "workspace/demo"},
        });
        const handler = (await import("nbook/server/api/text-to-image/reference-assets/[id].delete")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "TEXT_TO_IMAGE_REFERENCE_ASSET_IN_USE"},
        });
    });
});

/** 安装路由 seam；错误 mapper 与 h3 形状必须是真实实现。 */
function installMocks(options: {
    getQuery?: Record<string, string>;
    getRouterParam?: string;
    readBody?: unknown;
    setResponseHeader?: (event: unknown, name: string, value: string) => void;
    sendStream?: (event: unknown, stream: unknown) => unknown;
}): void {
    vi.doMock("h3", async (importOriginal) => {
        const h3 = await importOriginal<typeof import("h3")>();
        return {
            ...h3,
            ...(options.getQuery ? {getQuery: () => options.getQuery} : {}),
            ...(options.getRouterParam !== undefined ? {getRouterParam: () => options.getRouterParam} : {}),
            ...(options.readBody !== undefined ? {readBody: async () => options.readBody} : {}),
            ...(options.setResponseHeader ? {setResponseHeader: options.setResponseHeader} : {}),
            ...(options.sendStream ? {sendStream: options.sendStream} : {}),
        };
    });
    vi.doMock("node:fs", async (importOriginal) => {
        const fs = await importOriginal<typeof import("node:fs")>();
        return {
            ...fs,
            createReadStream: () => new PassThrough(),
        };
    });
    vi.doMock("nbook/server/utils/auth", () => ({
        requireCurrentUser: vi.fn(async () => {}),
    }));
    vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
        withProjectNotOpenHttpError: async (run: () => Promise<unknown>) => run(),
    }));
    vi.doMock("nbook/server/text-to-image/reference-asset.service", () => ({
        TextToImageReferenceAssetService: class {
            list = serviceStub.list;
            read = serviceStub.read;
            content = serviceStub.content;
            delete = serviceStub.delete;
        },
        TextToImageReferenceAssetNotFoundError,
        TextToImageReferenceAssetInUseError,
    }));
}

function sourceDto(): TextToImageReferenceAssetDto {
    return {
        id: "a".repeat(64),
        kind: "source-image",
        contentHash: "a".repeat(64),
        fileName: "vibe.png",
        mimeType: "image/png",
        byteLength: 12,
        width: 3,
        height: 2,
        status: "available",
        createdAt: "2026-08-01T00:00:00.000Z",
    };
}

/** 真实文件句柄只用来证明 createReadStream 收到绝对路径；不落盘。 */
function tempFile(): string {
    return "C:/__nbook_contract_test__/references/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
}
