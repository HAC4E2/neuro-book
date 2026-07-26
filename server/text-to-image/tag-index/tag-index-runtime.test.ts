import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {TagSourceReader} from "nbook/server/text-to-image/tag-index/tag-source-client";
import {
    TAG_INDEX_TERMS_CONTENT_HASH,
    TagIndexRuntime,
} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {
    TAG_INDEX_SOURCE_ENDPOINT,
    TAG_INDEX_SOURCE_KIND,
    TAG_INDEX_TERMS_CONFIRMATION_VERSION,
} from "nbook/shared/text-to-image-tag-index";

/** 测试用最小 source descriptor；只声明 tags，与生产 TtpSourceClient 的边界保持一致。 */
const TEST_SOURCE_DESCRIPTOR = {
    kind: TAG_INDEX_SOURCE_KIND,
    endpoint: TAG_INDEX_SOURCE_ENDPOINT,
    clientVersion: "test-source-v1",
    providedResources: ["tags"],
} as const;

describe("TagIndexRuntime", () => {
    let root = "";

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-tag-runtime-"));
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("reads absent local status without constructing or contacting an official source client", async () => {
        const createSourceClient = vi.fn((): TagSourceReader => ({
            descriptor: TEST_SOURCE_DESCRIPTOR,
            readWatermark: vi.fn(),
            readPage: vi.fn(),
        }));
        const runtime = new TagIndexRuntime({root, createSourceClient});

        const status = await runtime.status();

        expect(status.active).toBeNull();
        expect(status.operation).toBeNull();
        expect(status.source.endpoint).toBe(TAG_INDEX_SOURCE_ENDPOINT);
        expect(createSourceClient).not.toHaveBeenCalled();
    });

    it("returns the same operation for duplicate clicks and persists cancellation before aborting HTTP", async () => {
        const createSourceClient = vi.fn((): TagSourceReader => ({
            descriptor: TEST_SOURCE_DESCRIPTOR,
            readWatermark: vi.fn(async (_resource, signal) => new Promise<number>((_resolve, reject) => {
                signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
            })),
            readPage: vi.fn(),
        }));
        const runtime = new TagIndexRuntime({root, createSourceClient});
        const request = {
            confirmed: true as const,
            termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
            termsContentHash: TAG_INDEX_TERMS_CONTENT_HASH,
        };

        const first = await runtime.start(request);
        const second = await runtime.start(request);
        expect(second.operationId).toBe(first.operationId);
        expect(createSourceClient).toHaveBeenCalledTimes(1);

        await runtime.cancel(first.operationId);
        await runtime.wait(first.operationId);
        expect((await runtime.operation(first.operationId)).state).toBe("canceled");
    });

    it("rejects a stale terms content hash before creating an operation", async () => {
        const runtime = new TagIndexRuntime({root});
        await expect(runtime.start({
            confirmed: true,
            termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
            termsContentHash: `sha256:${"a".repeat(64)}`,
        })).rejects.toThrow(/terms content/u);
        expect((await runtime.status()).operation).toBeNull();
    });
});
