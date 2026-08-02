import {createHash} from "node:crypto";
import sharp from "sharp";

/** 构造确定性的合成 `.naiv4vibe` v1 JSON bytes；默认值满足全部严格边界。 */
export async function buildVibeContainerFixture(options: {
    identifier?: string;
    version?: number;
    type?: string;
    imageBase64?: string;
    bucket?: string;
    encodingCount?: number;
    /** 覆盖单个 encoding vendor id → {encoding base64, info} 映射。 */
    encodingsOverride?: Record<string, {encoding: string; informationExtracted: number}>;
    importInfo?: {model: string; strength: number; informationExtracted: number};
    name?: string;
    thumbnail?: string;
    createdAt?: number | string;
    extraTopKeys?: Record<string, unknown>;
    /** 直接提供原始 JSON（跳过默认组装）。 */
    rawJson?: unknown;
} = {}): Promise<Buffer> {
    const imageBase64 = options.imageBase64 ?? (await synthesizeJpeg()).toString("base64");
    const encodingCount = options.encodingCount ?? 2;
    const encodings: Record<string, {encoding: string; params: {information_extracted: number}}> = {};
    if (options.encodingsOverride) {
        for (const [vendorId, entry] of Object.entries(options.encodingsOverride)) {
            encodings[vendorId] = {encoding: entry.encoding, params: {information_extracted: entry.informationExtracted}};
        }
    } else {
        for (let index = 0; index < encodingCount; index += 1) {
            const info = 0.1 + index * 0.2;
            encodings[vendorEncodingId(index)] = {
                encoding: Buffer.from([index + 1, 2, 3, 4, 5]).toString("base64"),
                params: {information_extracted: Number(info.toFixed(1))},
            };
        }
    }
    const json = options.rawJson ?? {
        identifier: options.identifier ?? "novelai-vibe-transfer",
        version: options.version ?? 1,
        type: options.type ?? "image",
        image: imageBase64,
        id: "d".repeat(64),
        encodings: {[options.bucket ?? "v4-5full"]: encodings},
        name: options.name ?? "合成 Vibe",
        thumbnail: options.thumbnail ?? `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`,
        createdAt: options.createdAt ?? 1_764_754_058_867,
        importInfo: options.importInfo
            ? {model: options.importInfo.model, information_extracted: options.importInfo.informationExtracted, strength: options.importInfo.strength}
            : {model: "nai-diffusion-4-5-full", information_extracted: 0.2, strength: 0.3},
        ...(options.extraTopKeys ?? {}),
    };
    return Buffer.from(JSON.stringify(json), "utf8");
}

/** 确定性 vendor encoding id（64 hex）。 */
export function vendorEncodingId(index: number): string {
    return createHash("sha256").update(`vibe-encoding-${String(index)}`).digest("hex");
}

/** 确定性合法 JPEG（3x2）。 */
export async function synthesizeJpeg(background = "#4d65ff"): Promise<Buffer> {
    const image = sharp({
        create: {width: 3, height: 2, channels: 4, background},
    });
    return await image.jpeg().toBuffer();
}

/** 构造一个非法边界的容器：绕过深度检查的嵌套 JSON。 */
export function deepNestedJson(depth: number): unknown {
    let value: unknown = "leaf";
    for (let index = 0; index < depth; index += 1) {
        value = {nested: value};
    }
    return value;
}
