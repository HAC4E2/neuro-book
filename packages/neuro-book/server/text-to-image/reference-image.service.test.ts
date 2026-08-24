import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    deleteTextToImageReferenceImage,
    listTextToImageReferenceImages,
    resolveTextToImageReferenceImagePath,
    saveTextToImageReferenceImage,
} from "nbook/server/text-to-image/reference-image.service";

let workspaceRoot: string;

beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-reference-image-"));
    setWorkspaceRuntimeRootContextForTest({workspaceRoot});
});

afterEach(async () => {
    setWorkspaceRuntimeRootContextForTest(null);
    await rm(workspaceRoot, {recursive: true, force: true});
});

describe("reference-image.service", () => {
    it("保存并列出参考图", async () => {
        const bytes = new TextEncoder().encode("fake-png");
        const meta = await saveTextToImageReferenceImage({
            fileName: "alice.png",
            bytes,
        });

        expect(meta.relativePath).toMatch(/^text-to-image\/reference-images\/[a-f0-9]+\.png$/u);
        expect(meta.mimeType).toBe("image/png");
        expect(meta.byteLength).toBe(bytes.byteLength);
        expect(await readFile(await resolveTextToImageReferenceImagePath(meta.relativePath))).toEqual(Buffer.from(bytes));
        expect(await listTextToImageReferenceImages()).toEqual([
            expect.objectContaining({relativePath: meta.relativePath}),
        ]);
    });

    it("拒绝非图片扩展名", async () => {
        await expect(saveTextToImageReferenceImage({
            fileName: "evil.exe",
            bytes: new Uint8Array([1]),
        })).rejects.toThrow(/只支持 png\/jpg\/jpeg\/webp/);
    });

    it("删除后列表为空，越界路径被拒绝", async () => {
        const meta = await saveTextToImageReferenceImage({
            fileName: "a.webp",
            bytes: new Uint8Array([1, 2, 3]),
        });
        await deleteTextToImageReferenceImage(meta.relativePath);
        expect(await listTextToImageReferenceImages()).toEqual([]);
        await expect(resolveTextToImageReferenceImagePath("../secret.png")).rejects.toThrow(/越界/);
    });
});
