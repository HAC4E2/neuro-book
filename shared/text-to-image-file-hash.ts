import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex, utf8ToBytes} from "@noble/hashes/utils.js";

/** 对文本原始 UTF-8 字节计算浏览器与服务端一致的文件 hash。 */
export function createTextToImageFileHash(text: string): string {
    return `sha256:${bytesToHex(sha256(utf8ToBytes(text)))}`;
}
