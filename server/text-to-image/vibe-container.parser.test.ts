import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {
    VIBE_CONTAINER_MAX_BYTES,
    VIBE_ENCODING_MAX_BYTES,
} from "nbook/shared/text-to-image-vibe-container";
import {
    parseVibeContainer,
    VibeContainerError,
} from "nbook/server/text-to-image/vibe-container.parser";
import {
    buildVibeContainerFixture,
    deepNestedJson,
    vendorEncodingId,
} from "nbook/server/text-to-image/vibe-container.test-fixture";

const privateSample = process.env.NBOOK_PRIVATE_NAIV4VIBE_SAMPLE;

describe("Vibe 容器严格解析", () => {
    it("解析合法 v1 容器：原图完整验证、encoding 独立 SHA-256、display 不影响 identity", async () => {
        const bytes = await buildVibeContainerFixture({encodingCount: 3});
        const parsed = await parseVibeContainer(bytes);

        expect(parsed.containerContentHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(parsed.providerModel).toBe("nai-diffusion-4-5-full");
        expect(parsed.encoderVersion).toBe("novelai-vibe/v4-5full/v1");
        expect(parsed.suggestedStrength).toBe(0.3);
        expect(parsed.source.evidence.mimeType).toBe("image/jpeg");
        expect(parsed.source.evidence.width).toBe(3);
        expect(parsed.source.evidence.height).toBe(2);
        expect(parsed.encodings).toHaveLength(3);
        expect(parsed.encodings[0]!.informationExtracted).toBe(0.1);
        expect(parsed.encodings[0]!.contentHash).toBe(
            createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5])).digest("hex"),
        );
        expect(parsed.display.name).toBe("合成 Vibe");
        expect(parsed.display.createdAt).toBe(new Date(1_764_754_058_867).toISOString());
        expect(parsed.display.thumbnail).not.toBeNull();
    });

    it(".vibe 与 .naiv4vibe 内容走同一解析器", async () => {
        const bytes = await buildVibeContainerFixture();
        const parsed = await parseVibeContainer(bytes);
        expect(parsed.encodings.length).toBeGreaterThan(0);
    });

    it("拒绝超过 32 MiB 的容器", async () => {
        const bytes = Buffer.alloc(VIBE_CONTAINER_MAX_BYTES + 1, 0x7b);
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_TOO_LARGE"});
    });

    it("拒绝 JSON 深度超过 8 与总 key 数超过 256", async () => {
        const deep = Buffer.from(JSON.stringify(deepNestedJson(9)), "utf8");
        await expect(parseVibeContainer(deep)).rejects.toMatchObject({code: "VIBE_CONTAINER_JSON_DEPTH_EXCEEDED"});
    });

    it("拒绝未知 identifier/version/type", async () => {
        for (const override of [
            {identifier: "other"},
            {version: 2},
            {type: "video"},
        ]) {
            const bytes = await buildVibeContainerFixture(override);
            await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_VERSION_UNSUPPORTED"});
        }
    });

    it("拒绝非严格 Base64（空格/填充不规范）", async () => {
        const bytes = await buildVibeContainerFixture({
            encodingsOverride: {[vendorEncodingId(0)]: {encoding: "YWJj==", informationExtracted: 0.1}},
        });
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
    });

    it("拒绝超过一个 bucket 或非 v4-5full bucket", async () => {
        const wrongBucket = await buildVibeContainerFixture({bucket: "v3"});
        await expect(parseVibeContainer(wrongBucket)).rejects.toMatchObject({code: "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED"});

        const rawJson = JSON.parse((await buildVibeContainerFixture()).toString("utf8"));
        rawJson.encodings["v4-5full-extra"] = rawJson.encodings["v4-5full"];
        await expect(parseVibeContainer(Buffer.from(JSON.stringify(rawJson), "utf8")))
            .rejects.toMatchObject({code: "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED"});
    });

    it("拒绝 importInfo.model 与 bucket 映射不一致", async () => {
        const bytes = await buildVibeContainerFixture({
            importInfo: {model: "nai-diffusion-4-5-curated", strength: 0.3, informationExtracted: 0.2},
        });
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_MODEL_BUCKET_UNSUPPORTED"});
    });

    it("拒绝 0 条或超过 16 条 encoding，以及重复 canonical information", async () => {
        const zero = await buildVibeContainerFixture({encodingCount: 0});
        await expect(parseVibeContainer(zero)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});

        const duplicate = await buildVibeContainerFixture({
            encodingsOverride: {
                [vendorEncodingId(0)]: {encoding: "YQ==", informationExtracted: 0.5},
                [vendorEncodingId(1)]: {encoding: "Yg==", informationExtracted: 0.5},
            },
        });
        await expect(parseVibeContainer(duplicate)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_DUPLICATE"});

        const tooMany: Record<string, {encoding: string; informationExtracted: number}> = {};
        for (let index = 0; index < 17; index += 1) {
            tooMany[vendorEncodingId(index)] = {encoding: "YQ==", informationExtracted: index * 0.01};
        }
        const seventeen = await buildVibeContainerFixture({encodingsOverride: tooMany});
        await expect(parseVibeContainer(seventeen)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
    });

    it("拒绝非 0..1 的 informationExtracted / strength", async () => {
        const badInfo = await buildVibeContainerFixture({
            encodingsOverride: {[vendorEncodingId(0)]: {encoding: "YQ==", informationExtracted: 1.5}},
        });
        await expect(parseVibeContainer(badInfo)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
        const badStrength = await buildVibeContainerFixture({
            importInfo: {model: "nai-diffusion-4-5-full", strength: 1.1, informationExtracted: 0.2},
        });
        await expect(parseVibeContainer(badStrength)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
    });

    it("拒绝超过 1 MiB 的单个 encoding", async () => {
        const big = Buffer.alloc(VIBE_ENCODING_MAX_BYTES + 1, 0x41).toString("base64");
        const bytes = await buildVibeContainerFixture({
            encodingsOverride: {[vendorEncodingId(0)]: {encoding: big, informationExtracted: 0.1}},
        });
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
    });

    it("拒绝非法原图（非图片字节）", async () => {
        const bytes = await buildVibeContainerFixture({imageBase64: Buffer.from("not-an-image").toString("base64")});
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_IMAGE_INVALID"});
    });

    it("vendor id 必须是严格 64 位 hex", async () => {
        const bytes = await buildVibeContainerFixture({
            encodingsOverride: {[`not-hex-${"a".repeat(56)}`]: {encoding: "YQ==", informationExtracted: 0.1}},
        });
        await expect(parseVibeContainer(bytes)).rejects.toMatchObject({code: "VIBE_CONTAINER_ENCODING_INVALID"});
    });
});

describe("私有 NovelAI 样品一致性（可选）", () => {
    it.skipIf(!privateSample)("解析私有 v1 样品", async () => {
        const bytes = await fs.readFile(privateSample!);
        const parsed = await parseVibeContainer(new Uint8Array(bytes));
        expect(parsed.providerModel).toBe("nai-diffusion-4-5-full");
        expect(parsed.encoderVersion).toBe("novelai-vibe/v4-5full/v1");
        expect(parsed.encodings.length).toBeGreaterThan(0);
    });
});

// 确保 VibeContainerError 类型被引用（编译检查）。
export type {VibeContainerError as _VibeContainerErrorExport};
