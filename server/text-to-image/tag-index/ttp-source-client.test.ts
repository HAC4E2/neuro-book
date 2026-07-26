import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import CryptoJS from "crypto-js";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    TAG_INDEX_SOURCE_ENDPOINT,
    TAG_INDEX_SOURCE_KIND,
} from "nbook/shared/text-to-image-tag-index";
import {
    TTP_SOURCE_CLIENT_VERSION,
    TtpSourceClient,
} from "nbook/server/text-to-image/tag-index/ttp-source-client";

/** 与生产 ttp-source-client.ts 一致的 AES 解密密钥（上游数据自带，非本项目机密）。 */
const TTP_KEY = "a-very-secret-key-that-is-not-so-secret";

type TtpTagRow = {
    id_index: number;
    tag: string;
    color_id: number;
    translate: string;
    hot: number;
    aliases: number;
};

/** 构造一行原始 TTP tag 记录。 */
function row(id: number, tag: string, hot: number, colorId = 0): TtpTagRow {
    return {id_index: id, tag, color_id: colorId, translate: "", hot, aliases: 0};
}

/** 按生产 TtpSourceClient 的加密约定写入一个 danbooru_*.json 文件。 */
async function writeTagDataFile(dir: string, filename: string, rows: TtpTagRow[]): Promise<void> {
    const plaintext = JSON.stringify({danbooru_tag: rows});
    const encrypted = CryptoJS.AES.encrypt(plaintext, TTP_KEY).toString();
    await fs.writeFile(path.join(dir, filename), encrypted, "utf-8");
}

describe("TtpSourceClient", () => {
    let dir = "";

    beforeEach(async () => {
        // 只用现场加密构造的临时目录；不读取真实 .agent 或 assets 下的 tagData。
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-ttp-source-"));
    });

    afterEach(async () => {
        await fs.rm(dir, {recursive: true, force: true});
    });

    it("declares only the tags resource and filters rows below the 3000 post-count threshold", async () => {
        await writeTagDataFile(dir, "danbooru_1.json", [
            row(1, "low_hot", 2999),
            row(2, "high_hot", 3000),
        ]);
        const client = new TtpSourceClient({tagDataDir: dir});

        expect(client.descriptor).toEqual({
            kind: TAG_INDEX_SOURCE_KIND,
            endpoint: TAG_INDEX_SOURCE_ENDPOINT,
            clientVersion: TTP_SOURCE_CLIENT_VERSION,
            providedResources: ["tags"],
        });

        const watermark = await client.readWatermark("tags");
        expect(watermark).toBe(2);
        const page = await client.readPage({resource: "tags", pass: "source", cursor: 0, watermark});
        expect(page.records.map((record) => record.name)).toEqual(["high_hot"]);
        expect(page.done).toBe(true);
    });

    it("dedupes same-name tags across files, keeping the first file/row occurrence", async () => {
        await writeTagDataFile(dir, "danbooru_1.json", [row(1, "dup_tag", 5000, 0)]);
        await writeTagDataFile(dir, "danbooru_2.json", [row(2, "dup_tag", 9000, 1)]);
        const client = new TtpSourceClient({tagDataDir: dir});

        const watermark = await client.readWatermark("tags");
        const page = await client.readPage({resource: "tags", pass: "source", cursor: 0, watermark});

        expect(page.records).toHaveLength(1);
        expect(page.records[0]).toMatchObject({id: 1, name: "dup_tag", postCount: 5000, categoryId: 0});
    });

    it("pages tags in ascending ID order with provenance consistent with the returned records", async () => {
        const rows: TtpTagRow[] = [];
        for (let id = 1; id <= 1500; id += 1) rows.push(row(id, `tag_${id}`, 3000 + id));
        // 打乱顺序并拆分到两个文件，验证 client 自行按 ID 排序而非依赖输入顺序。
        await writeTagDataFile(dir, "danbooru_1.json", rows.filter((_value, index) => index % 2 === 0).reverse());
        await writeTagDataFile(dir, "danbooru_2.json", rows.filter((_value, index) => index % 2 === 1).reverse());
        const client = new TtpSourceClient({tagDataDir: dir});

        const watermark = await client.readWatermark("tags");
        expect(watermark).toBe(1500);

        const first = await client.readPage({resource: "tags", pass: "source", cursor: 0, watermark});
        expect(first.done).toBe(false);
        expect(first.records.map((record) => record.id)).toEqual(Array.from({length: 1000}, (_value, index) => index + 1));
        expect(first.provenance).toMatchObject({
            resource: "tags",
            pass: "source",
            cursorStart: 0,
            cursorEnd: 1000,
            watermark: 1500,
            recordCount: 1000,
        });

        const second = await client.readPage({resource: "tags", pass: "source", cursor: first.nextCursor, watermark});
        expect(second.done).toBe(true);
        expect(second.nextCursor).toBe(1500);
        expect(second.records.map((record) => record.id)).toEqual(Array.from({length: 500}, (_value, index) => index + 1001));
        expect(second.provenance).toMatchObject({
            cursorStart: 1000,
            cursorEnd: 1500,
            watermark: 1500,
            recordCount: 500,
        });
    });

    it("returns an empty done page for resources it does not provide", async () => {
        await writeTagDataFile(dir, "danbooru_1.json", [row(1, "only_tag", 5000)]);
        const client = new TtpSourceClient({tagDataDir: dir});

        expect(await client.readWatermark("aliases")).toBe(1);
        expect(await client.readWatermark("implications")).toBe(1);

        expect(await client.readPage({resource: "aliases", pass: "source", cursor: 0, watermark: 1}))
            .toEqual({resource: "aliases", records: [], nextCursor: 1, done: true, provenance: null});
        expect(await client.readPage({resource: "implications", pass: "reconciliation", cursor: 0, watermark: 1}))
            .toEqual({resource: "implications", records: [], nextCursor: 1, done: true, provenance: null});
    });

    it("produces identical records on the same instance across the source and reconciliation passes", async () => {
        await writeTagDataFile(dir, "danbooru_1.json", [
            row(1, "alpha", 4000),
            row(2, "beta", 5000),
        ]);
        const client = new TtpSourceClient({tagDataDir: dir});
        const watermark = await client.readWatermark("tags");

        const source = await client.readPage({resource: "tags", pass: "source", cursor: 0, watermark});
        const reconciliation = await client.readPage({resource: "tags", pass: "reconciliation", cursor: 0, watermark});

        expect(reconciliation.records).toEqual(source.records);
        expect(reconciliation.provenance?.hash).toBe(source.provenance?.hash);
    });
});
