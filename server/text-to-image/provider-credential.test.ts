import {randomBytes} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    openTextToImageCredential,
    sealTextToImageCredential,
} from "nbook/server/text-to-image/provider-credential";

const temporaryDirectories: string[] = [];

describe("text-to-image provider credentials", () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
            await rm(directory, {recursive: true, force: true});
        }));
    });

    it("seals credentials with a workspace key and opens them again", async () => {
        const keyPath = await createKeyPath();
        const sealed = await sealTextToImageCredential("secret-token", keyPath);

        expect(await openTextToImageCredential(sealed, keyPath)).toBe("secret-token");
        expect((await readFile(keyPath)).byteLength).toBe(32);
        if (process.platform !== "win32") {
            expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
        }
    });

    it("uses a fresh IV for every save", async () => {
        const keyPath = await createKeyPath();
        const first = await sealTextToImageCredential("secret-token", keyPath);
        const second = await sealTextToImageCredential("secret-token", keyPath);

        expect(first.iv).not.toBe(second.iv);
        expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it("atomically publishes one complete key to concurrent callers", async () => {
        const keyPath = await createKeyPath();
        const sealed = await Promise.all(Array.from({length: 64}, async (_, index) => {
            return await sealTextToImageCredential(`secret-${index}`, keyPath);
        }));

        await expect(Promise.all(sealed.map(async (value, index) => {
            return await openTextToImageCredential(value, keyPath) === `secret-${index}`;
        }))).resolves.toEqual(Array.from({length: 64}, () => true));
        expect((await readFile(keyPath)).byteLength).toBe(32);
    });

    it("waits for an in-progress competing key writer", async () => {
        const keyPath = await createKeyPath();
        await mkdir(path.dirname(keyPath), {recursive: true});
        await writeFile(keyPath, Buffer.alloc(0));
        const completedKey = randomBytes(32);
        const timer = setTimeout(() => {
            void writeFile(keyPath, completedKey);
        }, 20);

        try {
            const sealed = await sealTextToImageCredential("waited-secret", keyPath);
            await expect(openTextToImageCredential(sealed, keyPath)).resolves.toBe("waited-secret");
            expect(await readFile(keyPath)).toEqual(completedKey);
        } finally {
            clearTimeout(timer);
        }
    });

    it("rejects an altered authentication tag", async () => {
        const keyPath = await createKeyPath();
        const sealed = await sealTextToImageCredential("secret-token", keyPath);

        await expect(openTextToImageCredential({...sealed, tag: "AAAA"}, keyPath)).rejects.toThrow();
    });
});

async function createKeyPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-text-to-image-credential-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "workspace", ".nbook", "secrets", "text-to-image.key");
}
