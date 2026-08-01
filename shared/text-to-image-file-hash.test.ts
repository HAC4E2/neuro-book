import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";

describe("text-to-image file hash", () => {
    it("uses UTF-8 SHA-256 bytes identically in browser-safe and Node runtimes", () => {
        const text = "角色：林雪\r\n服装：白色衬衫\r\n";
        const nodeHash = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

        expect(createTextToImageFileHash(text)).toBe(nodeHash);
        expect(createTextToImageFileHash(text)).toBe("sha256:a01ebcd53e8a1003967b6bd80339b82aff9b87de805ce0ce87d70056c7e23f4c");
    });
});
