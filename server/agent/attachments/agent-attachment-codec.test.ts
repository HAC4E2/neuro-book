import {describe, expect, it, vi} from "vitest";
import {AgentAttachmentCodec, attachmentMarker} from "nbook/server/agent/attachments/agent-attachment-codec";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

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

    it("saveImage 接受 PNG、JPEG、GIF、WebP 魔数和精确 16 MiB 边界", async () => {
        const adapter = memoryAdapter();
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const exactLimitPng = new Uint8Array(AGENT_IMAGE_POLICY.maxImageBytes);
        exactLimitPng.set(png.subarray(0, 8));
        const samples: Array<{mimeType: string; bytes: Uint8Array}> = [
            {mimeType: "image/png", bytes: exactLimitPng},
            {mimeType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])},
            {mimeType: "image/gif", bytes: Uint8Array.from(Buffer.from("GIF89a", "ascii"))},
            {mimeType: "image/webp", bytes: Uint8Array.from(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "binary"))},
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
