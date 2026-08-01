import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import sharp from "sharp";
import {afterEach, describe, expect, it} from "vitest";
import {
    MAX_REFERENCE_IMAGE_BYTES,
    readAndVerifyReferenceImage,
    TextToImageReferenceImageError,
    verifyReferenceImageBytes,
} from "nbook/server/text-to-image/reference-image";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("文生图引用图片校验", () => {
    it.each([
        ["png", "image/png"],
        ["jpeg", "image/jpeg"],
    ] as const)("接受完整的 %s，并按原始字节返回不可变证据", async (format, mimeType) => {
        const bytes = await createImage(format);
        const original = Buffer.from(bytes);

        const evidence = await verifyReferenceImageBytes(bytes);

        expect(evidence).toEqual({
            contentHash: createHash("sha256").update(bytes).digest("hex"),
            mimeType,
            byteLength: bytes.byteLength,
            width: 3,
            height: 2,
        });
        expect(Object.isFrozen(evidence)).toBe(true);
        expect(bytes).toEqual(original);
    });

    it("拒绝 WebP、未知魔数和超过 20 MiB 的输入", async () => {
        const webp = await sharp({
            create: {width: 1, height: 1, channels: 4, background: "#ffffff"},
        }).webp().toBuffer();

        await expect(verifyReferenceImageBytes(webp)).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_UNSUPPORTED",
        });
        await expect(verifyReferenceImageBytes(Buffer.from("not-an-image"))).rejects.toBeInstanceOf(
            TextToImageReferenceImageError,
        );
        await expect(verifyReferenceImageBytes(Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES + 1))).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_TOO_LARGE",
        });
    });

    it("用完整解码拒绝只有合法头部的截断 PNG 和 JPEG", async () => {
        const png = await createImage("png");
        const jpeg = await createImage("jpeg");

        await expect(verifyReferenceImageBytes(png.subarray(0, 24))).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_INVALID",
        });
        await expect(verifyReferenceImageBytes(jpeg.subarray(0, 32))).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_INVALID",
        });
    });

    it("拒绝魔数不能被完整解码器确认的伪装输入", async () => {
        const jpeg = await createImage("jpeg");
        const disguised = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            jpeg,
        ]);

        await expect(verifyReferenceImageBytes(disguised)).rejects.toBeInstanceOf(TextToImageReferenceImageError);
    });

    it("拒绝超边长和超过 6400 万像素的图片声明", async () => {
        await expect(verifyReferenceImageBytes(createHeaderOnlyPng(16_385, 1))).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_DIMENSIONS_INVALID",
        });
        await expect(verifyReferenceImageBytes(createHeaderOnlyPng(8_001, 8_000))).rejects.toMatchObject({
            code: "REFERENCE_IMAGE_DIMENSIONS_INVALID",
        });
    });

    it("读取落盘文件时重新校验 expected MIME、哈希、长度与尺寸", async () => {
        const directory = await createTemporaryDirectory();
        const absolutePath = path.join(directory, "source.png");
        const bytes = await createImage("png");
        await writeFile(absolutePath, bytes);
        const expected = await verifyReferenceImageBytes(bytes);

        await expect(readAndVerifyReferenceImage({absolutePath, expected})).resolves.toMatchObject({
            bytes,
            evidence: expected,
        });
        await expect(readAndVerifyReferenceImage({
            absolutePath,
            expected: {...expected, mimeType: "image/jpeg"},
        })).rejects.toMatchObject({code: "REFERENCE_ASSET_TAMPERED"});

        await writeFile(absolutePath, bytes.subarray(0, 24));
        await expect(readAndVerifyReferenceImage({absolutePath, expected})).rejects.toMatchObject({
            code: "REFERENCE_ASSET_TAMPERED",
        });
    });

    it("为缺失的落盘文件返回稳定错误", async () => {
        const directory = await createTemporaryDirectory();
        const bytes = await createImage("png");
        const expected = await verifyReferenceImageBytes(bytes);

        await expect(readAndVerifyReferenceImage({
            absolutePath: path.join(directory, "missing.png"),
            expected,
        })).rejects.toMatchObject({code: "REFERENCE_ASSET_MISSING"});
    });
});

async function createImage(format: "png" | "jpeg"): Promise<Buffer> {
    const image = sharp({
        create: {width: 3, height: 2, channels: 4, background: "#4d65ff"},
    });
    return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-reference-image-"));
    temporaryDirectories.push(directory);
    return directory;
}

function createHeaderOnlyPng(width: number, height: number): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", ihdr),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const chunk = Buffer.alloc(12 + data.byteLength);
    chunk.writeUInt32BE(data.byteLength, 0);
    typeAndData.copy(chunk, 4);
    chunk.writeUInt32BE(crc32(typeAndData), 8 + data.byteLength);
    return chunk;
}

function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
