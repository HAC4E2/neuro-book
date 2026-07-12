import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";
import {chmod, link, mkdir, open, readFile, unlink} from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-assets-root";

export type SealedCredential = {ciphertext: string; iv: string; tag: string};

const masterKeyBytes = 32;
const ivBytes = 12;
const keyReadAttempts = 20;
const keyReadDelayMs = 5;

/**
 * 使用 Workspace Root 专用主密钥密封 Provider 凭据。
 */
export async function sealTextToImageCredential(value: string, keyPath?: string): Promise<SealedCredential> {
    const key = await loadMasterKey(keyPath);
    const iv = randomBytes(ivBytes);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
}

/**
 * 打开已持久化的 Provider 凭据；认证失败时绝不返回部分明文。
 */
export async function openTextToImageCredential(value: SealedCredential, keyPath?: string): Promise<string> {
    const key = await loadMasterKey(keyPath);
    const iv = Buffer.from(value.iv, "base64");
    const tag = Buffer.from(value.tag, "base64");
    if (iv.byteLength !== ivBytes || tag.byteLength !== 16) {
        throw new Error("Provider 凭据密文不合法");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64")),
        decipher.final(),
    ]).toString("utf8");
}

async function loadMasterKey(keyPath?: string): Promise<Buffer> {
    const resolvedPath = keyPath ?? path.join(resolveUserNbookRoot(), "secrets", "text-to-image.key");
    await mkdir(path.dirname(resolvedPath), {recursive: true});
    const existingKey = await readExistingKey(resolvedPath);
    if (existingKey?.byteLength === masterKeyBytes) {
        return existingKey;
    }
    if (existingKey) {
        return await waitForCompleteKey(resolvedPath);
    }

    await publishMasterKey(resolvedPath);
    return await waitForCompleteKey(resolvedPath);
}

async function publishMasterKey(resolvedPath: string): Promise<void> {
    const temporaryPath = `${resolvedPath}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
        await handle.writeFile(randomBytes(masterKeyBytes));
        await handle.sync();
    } finally {
        await handle.close();
    }
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    try {
        try {
            await link(temporaryPath, resolvedPath);
        } catch (error) {
            if (!isExistingFileError(error)) {
                throw error;
            }
        }
    } finally {
        await unlink(temporaryPath).catch(() => undefined);
    }
}

async function waitForCompleteKey(resolvedPath: string): Promise<Buffer> {
    for (let attempt = 0; attempt < keyReadAttempts; attempt += 1) {
        const key = await readExistingKey(resolvedPath);
        if (key?.byteLength === masterKeyBytes) {
            return key;
        }
        await delay(keyReadDelayMs);
    }
    throw new Error("Provider 主密钥长度不合法");
}

async function readExistingKey(resolvedPath: string): Promise<Buffer | null> {
    try {
        return await readFile(resolvedPath);
    } catch (error) {
        if (isMissingFileError(error)) {
            return null;
        }
        throw error;
    }
}

function isExistingFileError(error: unknown): error is NodeJS.ErrnoException {
    // Filesystem failures are unknown at the promise boundary; only EEXIST is consumed.
    return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    // Filesystem failures are unknown at the promise boundary; only ENOENT is consumed.
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
