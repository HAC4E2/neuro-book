import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const MASK_RELATIVE_DIRECTORY = "assets/tti-masks";
const MAX_MASK_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type TextToImageMaskMeta = {
    relativePath: string;
    fileName: string;
    byteLength: number;
};

/** 淇濆瓨遮鐓﹀埌椤圭洰 `assets/tti-masks/`锛涗笉寤?DB 璁板綍锛岄殢遮鐓﹀悓姝ュ叆闃熴€?*/
export async function saveTextToImageMask(input: {
    projectPath: string;
    bytes: Uint8Array;
}): Promise<TextToImageMaskMeta> {
    if (input.bytes.byteLength > MAX_MASK_BYTES) {
        throw new Error(`遮鐓﹁秴杩?{MAX_MASK_BYTES} 瀛楄妭涓婇檺`);
    }
    if (!isPngBytes(input.bytes)) {
        throw new Error("遮鐓﹀彧鏀寔 PNG 鍥惧儚");
    }
    const id = randomUUID();
    const relativePath = `${MASK_RELATIVE_DIRECTORY}/${id}.png`;
    const projectRoot = resolveTextToImageProjectRoot(input.projectPath);
    const targetPath = resolveTextToImageAssetPath(projectRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, input.bytes);
    await fs.rename(temporaryPath, targetPath);
    return {
        relativePath,
        fileName: `${id}.png`,
        byteLength: input.bytes.byteLength,
    };
}

/** 璇诲彇椤圭洰鍐呯殑遮鐓у師濮嬪瓧鑺傦紱浣滅粍鍚堝弬鑰冭В鏋愬櫒鐨勪竴閮ㄥ垎銆?*/
export async function readTextToImageMaskBytes(projectPath: string, relativePath: string): Promise<Uint8Array> {
    const projectRoot = resolveTextToImageProjectRoot(projectPath);
    return new Uint8Array(await fs.readFile(resolveTextToImageAssetPath(projectRoot, relativePath)));
}

function isPngBytes(bytes: Uint8Array): boolean {
    if (bytes.byteLength < PNG_SIGNATURE.byteLength) {
        return false;
    }
    return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}
