import sharp from "sharp";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {AgentAttachmentCodec, attachmentMarker} from "nbook/server/agent/attachments/agent-attachment-codec";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

let png: Buffer;
let jpeg: Buffer;
let gif: Buffer;
let webp: Buffer;
let oversizedJpeg: Buffer;

beforeAll(async () => {
    const image = sharp({create: {width: 2, height: 2, channels: 4, background: "#224466"}});
    [png, jpeg, webp] = await Promise.all([
        image.clone().png().toBuffer(),
        image.clone().jpeg().toBuffer(),
        image.clone().webp().toBuffer(),
    ]);
    oversizedJpeg = jpegWithDimensions(jpeg, 8_193, 8_192);
    gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
});

function memoryAdapter(): AttachmentBlobAdapter {
    const values = new Map<string, Uint8Array>();
    return {
        async put(key, bytes) { values.set(key, bytes.slice()); },
        async get(key) { return values.get(key)?.slice() ?? null; },
    };
}

describe("AgentAttachmentCodec", () => {
    it("saveImage 在写入前校验大小、魔数与声明 MIME", async () => {
        const adapter = memoryAdapter();
        const put = vi.spyOn(adapter, "put");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));

        await expect(codec.saveImage({
            bytes: new Uint8Array(16 * 1024 * 1024 + 1),
            mimeType: "image/png",
        })).rejects.toMatchObject({code: "limit_exceeded"});
        await expect(codec.saveImage({bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png"}))
            .rejects.toMatchObject({code: "invalid_input"});
        await expect(codec.saveImage({bytes: png, mimeType: "image/jpeg"}))
            .rejects.toMatchObject({code: "invalid_input"});
        expect(put).not.toHaveBeenCalled();
    });

    it("saveImage 接受可完整解码的 PNG、JPEG、GIF、WebP 和精确 16 MiB 边界", async () => {
        const adapter = memoryAdapter();
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const exactLimitPng = Buffer.alloc(AGENT_IMAGE_POLICY.maxImageBytes);
        png.copy(exactLimitPng);
        const samples: Array<{mimeType: string; bytes: Uint8Array}> = [
            {mimeType: "image/png", bytes: exactLimitPng},
            {mimeType: "image/jpeg", bytes: jpeg},
            {mimeType: "image/gif", bytes: gif},
            {mimeType: "image/webp", bytes: webp},
        ];

        for (const sample of samples) {
            await expect(codec.saveImage(sample)).resolves.toMatchObject({
                attachment: {
                    mimeType: sample.mimeType,
                    bytes: sample.bytes.byteLength,
                },
            });
        }
    });

    it("saveImage 把 multipart 的通用占位 MIME 交给图片 bytes 裁决", async () => {
        const codec = new AgentAttachmentCodec(new AttachmentStore(memoryAdapter()));

        await expect(codec.saveImage({bytes: png, mimeType: "application/octet-stream"}))
            .resolves.toMatchObject({attachment: {mimeType: "image/png"}});
        await expect(codec.saveImage({bytes: png, mimeType: "text/plain"}))
            .rejects.toMatchObject({code: "invalid_input"});
        await expect(codec.saveImage({
            bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            mimeType: "application/octet-stream",
        })).rejects.toMatchObject({code: "invalid_input"});
    });

    it("saveImage 在写入 Store 前把超过 64 MP 的图片归类为 limit_exceeded", async () => {
        const adapter = memoryAdapter();
        const put = vi.spyOn(adapter, "put");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));

        await expect(codec.saveImage({bytes: oversizedJpeg, mimeType: "image/jpeg"}))
            .rejects.toMatchObject({code: "limit_exceeded"});
        expect(put).not.toHaveBeenCalled();
    });

    it("Provider 预算按 attachment 出现次数计算且超限前不读取 blob", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = {
            type: "attachment" as const,
            attachment: {id: `sha256:${"a".repeat(64)}` as const, mimeType: "image/png", bytes: 40 * 1024 * 1024},
        };

        await expect(codec.hydrateForProvider([
            {role: "user", content: [block, block], timestamp: 1},
        ], model(["text", "image"]))).rejects.toMatchObject({code: "limit_exceeded"});
        expect(get).not.toHaveBeenCalled();
    });

    it("图片只在视觉 Provider 请求期间 hydrate", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = await codec.saveImage({bytes: png, mimeType: "image/png", name: "a.png"});
        const messages: StoredAgentMessage[] = [{role: "user", content: [block], timestamp: 1}];

        const textOnly = await codec.hydrateForProvider(messages, model(["text"]));
        expect(get).not.toHaveBeenCalled();
        expect(textOnly[0]?.content).toEqual([{type: "text", text: attachmentMarker(block)}]);

        const vision = await codec.hydrateForProvider(messages, model(["text", "image"]));
        expect(get).toHaveBeenCalledTimes(1);
        expect(vision[0]?.content).toEqual([{type: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64")}]);
        expect(messages[0]?.content).toEqual([block]);
    });

    it("同一 Provider 请求按 attachment id 去重读取", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = await codec.saveImage({bytes: png, mimeType: "image/png"});
        await codec.hydrateForProvider([
            {role: "user", content: [block], timestamp: 1},
            {role: "toolResult", toolCallId: "1", toolName: "read", content: [block], isError: false, timestamp: 2},
        ], model(["text", "image"]));
        expect(get).toHaveBeenCalledTimes(1);
    });
});

function model(input: Array<"text" | "image">) {
    return {
        id: "test",
        name: "test",
        api: "openai-completions" as const,
        provider: "openai" as const,
        baseUrl: "http://localhost",
        reasoning: false,
        input,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 1000,
        maxTokens: 100,
    };
}

/** 只改 JPEG SOF 尺寸，构造低字节量的像素上限 fixture。 */
function jpegWithDimensions(input: Buffer, width: number, height: number): Buffer {
    const result = Buffer.from(input);
    for (let index = 0; index < result.length - 8; index += 1) {
        const marker = result[index + 1];
        if (result[index] !== 0xff || marker === undefined || !isStartOfFrame(marker)) {
            continue;
        }
        result.writeUInt16BE(height, index + 5);
        result.writeUInt16BE(width, index + 7);
        return result;
    }
    throw new Error("JPEG fixture 缺少 SOF marker");
}

/** 判断 JPEG marker 是否携带宽高。 */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0
        && marker <= 0xcf
        && marker !== 0xc4
        && marker !== 0xc8
        && marker !== 0xcc;
}
