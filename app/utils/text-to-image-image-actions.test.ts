import {afterEach, describe, expect, it, vi} from "vitest";
import {copyImageBlobToClipboard, downloadImageBlob, readImageBlob, resolveImageDownloadFileName} from "nbook/app/utils/text-to-image-image-actions";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("text-to-image image actions", () => {
    it("图片接口返回 404/403 时给出原图读取错误", async () => {
        for (const status of [404, 403]) {
            const fetchImpl = vi.fn(async () => new Response("missing", {status}));

            await expect(readImageBlob("/api/text-to-image/assets/image", fetchImpl)).rejects.toThrow("无法读取原图，请刷新资产后重试");
        }
    });

    it("图片接口返回空内容或非图片 MIME 时拒绝读取", async () => {
        const empty = vi.fn(async () => new Response(new Blob([], {type: "image/png"}), {status: 200}));
        const text = vi.fn(async () => new Response("not image", {
            status: 200,
            headers: {"content-type": "text/plain"},
        }));

        await expect(readImageBlob("/empty", empty)).rejects.toThrow("无法读取原图，请刷新资产后重试");
        await expect(readImageBlob("/text", text)).rejects.toThrow("无法读取原图，请刷新资产后重试");
    });

    it("Clipboard API 不可用时提示使用下载", async () => {
        vi.stubGlobal("navigator", {});

        await expect(copyImageBlobToClipboard(new Blob(["image"], {type: "image/png"}))).rejects.toThrow("当前环境不支持复制图片，请使用下载");
    });

    it("系统拒绝剪贴板权限时使用稳定错误", async () => {
        vi.stubGlobal("navigator", {clipboard: {write: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); })}});
        vi.stubGlobal("ClipboardItem", class {
            constructor(public readonly items: Record<string, Blob>) {}
        });

        await expect(copyImageBlobToClipboard(new Blob(["image"], {type: "image/png"}))).rejects.toThrow("图片复制被系统拒绝，请检查剪贴板权限");
    });

    it("非 PNG 图片先按原始像素转成 PNG 再交给剪贴板", async () => {
        const write = vi.fn(async (items: ClipboardItems) => {
            const item = items[0];
            if (!item) throw new Error("missing item");
            const png = await item.getType("image/png");
            expect(png.type).toBe("image/png");
            expect(png.size).toBeGreaterThan(0);
        });
        vi.stubGlobal("navigator", {clipboard: {write}});
        vi.stubGlobal("ClipboardItem", class {
            constructor(private readonly items: Record<string, Blob | Promise<Blob>>) {}
            async getType(type: string): Promise<Blob> {
                const value = this.items[type];
                if (!value) throw new Error("missing type");
                return await value;
            }
        });
        vi.stubGlobal("createImageBitmap", async () => ({
            width: 2,
            height: 3,
            close: vi.fn(),
        }));
        vi.stubGlobal("document", {
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => ({drawImage: vi.fn()}),
                toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"], {type: "image/png"})),
            }),
        });

        await copyImageBlobToClipboard(new Blob(["jpeg"], {type: "image/jpeg"}));
        expect(write).toHaveBeenCalledOnce();
    });

    it("空图片禁止下载", () => {
        expect(() => downloadImageBlob(new Blob([], {type: "image/png"}), "empty.png"))
            .toThrow("下载失败：图片文件为空");
    });

    it("清理下载文件名并按 Blob MIME 修正扩展名", () => {
        expect(resolveImageDownloadFileName("..\\bad:name.jpg", "image/png")).toBe("bad_name.png");
        expect(resolveImageDownloadFileName("safe-name", "")).toBe("safe-name");
    });
});
