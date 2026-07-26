import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import CryptoJS from "crypto-js";
import {
    DANBOORU_MIN_POST_COUNT,
    TAG_INDEX_SOURCE_ENDPOINT,
    TAG_INDEX_SOURCE_KIND,
    TagIndexPageProvenanceSchema,
} from "nbook/shared/text-to-image-tag-index";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import type {
    DanbooruRelationshipSourceRecord,
    DanbooruTagSourceRecord,
    TagSourceDescriptor,
    TagSourcePage,
    TagSourcePageInput,
    TagSourceReader,
    TagSourceResource,
} from "nbook/server/text-to-image/tag-index/tag-source-client";

export const TTP_SOURCE_CLIENT_VERSION = "nbook-ttp-source-v1" as const;

/** TTP tagData 文件的 AES 解密密钥（上游数据自带，非本项目机密）。 */
const TTP_KEY = "a-very-secret-key-that-is-not-so-secret";

/** 每页记录数，与 page provenance 的 recordCount 上限对齐。 */
const PAGE_SIZE = 1000;

/** Danbooru category ID 收窄；未知类别按 general 处理。 */
function mapCategory(colorId: unknown): 0 | 1 | 3 | 4 | 5 {
    const id = typeof colorId === "number" ? colorId : 0;
    const valid = new Set([0, 1, 3, 4, 5]);
    return valid.has(id) ? (id as 0 | 1 | 3 | 4 | 5) : 0;
}

interface TtpTagRow {
    id_index: number;
    tag: string;
    color_id: number;
    translate: string;
    hot: number;
    aliases: number;
}

/** 计算 page 的 SHA-256 provenance，与 provenance 合同格式一致。 */
function computeProvenance(params: {
    resource: "tags";
    pass: "source" | "reconciliation";
    records: DanbooruTagSourceRecord[];
    cursorStart: number;
    cursorEnd: number;
    watermark: number;
}): ReturnType<typeof TagIndexPageProvenanceSchema.parse> {
    const json = JSON.stringify(params.records);
    const byteLength = Buffer.byteLength(json, "utf-8");
    const hash = createHash("sha256").update(json, "utf-8").digest("hex");
    return TagIndexPageProvenanceSchema.parse({
        resource: params.resource,
        pass: params.pass,
        pageIdentity: `${params.resource}.${params.pass}.${params.cursorStart}.${params.cursorEnd}`,
        cursorStart: params.cursorStart,
        cursorEnd: params.cursorEnd,
        watermark: params.watermark,
        recordCount: params.records.length,
        byteLength,
        contentType: "application/json",
        hash: `sha256:${hash}`,
    });
}

/**
 * 基于本地 TTP AES 加密 tagData 文件读取 Danbooru 衍生 tag 索引源。
 * 只声明提供 tags 资源；alias/implication 由 descriptor 显式标记为源不提供。
 * 时间戳取 tagData 文件最大 mtime，保证同一份数据两轮/多次导入产出一致记录。
 */
export class TtpSourceClient implements TagSourceReader {
    readonly descriptor: TagSourceDescriptor = {
        kind: TAG_INDEX_SOURCE_KIND,
        endpoint: TAG_INDEX_SOURCE_ENDPOINT,
        clientVersion: TTP_SOURCE_CLIENT_VERSION,
        providedResources: ["tags"],
    };

    /** 按 Danbooru ID 升序排列的已过滤 tag 记录 */
    private sortedTags: DanbooruTagSourceRecord[] | null = null;
    /** 最大 Danbooru ID（= watermark） */
    private maxId: number | null = null;
    private readonly tagDataDir: string;

    constructor(options: {tagDataDir?: string} = {}) {
        const dir = options.tagDataDir ?? resolveTtpTagDataDir();
        if (!dir) {
            throw new TagIndexError({
                code: "TAG_INDEX_SOURCE_UNAVAILABLE",
                message: "未找到本地 TTP tagData 目录；应用打包数据缺失或 TTP_TAGDATA_DIR 未指向有效目录",
            });
        }
        this.tagDataDir = dir;
    }

    /** 惰性加载、去重、过滤并排序全部 tag 记录 */
    private loadTags(): void {
        if (this.sortedTags) return;

        const files = fs.readdirSync(this.tagDataDir)
            .filter(f => /^danbooru_\d+\.json$/.test(f))
            .sort();

        if (files.length === 0) {
            throw new TagIndexError({
                code: "TAG_INDEX_SOURCE_UNAVAILABLE",
                message: `本地 TTP tagData 目录没有 danbooru_*.json 文件: ${this.tagDataDir}`,
            });
        }

        // 用文件最大 mtime 作为记录时间戳：同一份数据多次加载产出完全一致的记录
        let latestMtimeMs = 0;
        for (const file of files) {
            const stat = fs.statSync(path.join(this.tagDataDir, file));
            latestMtimeMs = Math.max(latestMtimeMs, Math.floor(stat.mtimeMs));
        }
        const sourceTimestamp = new Date(latestMtimeMs).toISOString();

        const seen = new Set<string>();
        const result: DanbooruTagSourceRecord[] = [];

        for (const file of files) {
            const filePath = path.join(this.tagDataDir, file);
            const encrypted = fs.readFileSync(filePath, "utf-8");
            const decrypted = CryptoJS.AES.decrypt(encrypted, TTP_KEY);
            const text = decrypted.toString(CryptoJS.enc.Utf8);
            if (!text) {
                throw new TagIndexError({code: "TAG_INDEX_SOURCE_SCHEMA_CHANGED", message: `本地 TTP tagData 解密失败: ${filePath}`});
            }

            const data = JSON.parse(text);
            const rows: TtpTagRow[] = data.danbooru_tag;
            if (!Array.isArray(rows)) continue;

            for (const row of rows) {
                const hot = typeof row.hot === "number" ? row.hot : 0;
                if (hot < DANBOORU_MIN_POST_COUNT) continue;

                const name = String(row.tag || "").trim();
                if (!name || seen.has(name) || !row.id_index) continue;
                seen.add(name);

                result.push({
                    id: row.id_index,
                    name,
                    categoryId: mapCategory(row.color_id),
                    postCount: hot,
                    isDeprecated: false,
                    createdAt: sourceTimestamp,
                    updatedAt: sourceTimestamp,
                });
            }
        }

        // 按 Danbooru ID 升序排列，供 ID-based cursor 分页
        result.sort((a, b) => a.id - b.id);
        this.sortedTags = result;
        this.maxId = result.length > 0 ? result[result.length - 1]!.id : 1;
    }

    /**
     * 返回各资源的 frozen watermark（= 最大 Danbooru ID）。
     * 未声明的资源返回占位值 1 以满足 watermark > 0 合同；同步循环会以空 done 页跳过它们。
     */
    async readWatermark(resource: TagSourceResource): Promise<number> {
        if (resource === "tags") {
            this.loadTags();
            return this.maxId ?? 1;
        }
        return 1;
    }

    async readPage(input: TagSourcePageInput): Promise<TagSourcePage> {
        if (input.resource !== "tags") {
            // descriptor 已声明不提供 alias/implication；直接返回结束页
            return {
                resource: input.resource as "aliases" | "implications",
                records: [] as DanbooruRelationshipSourceRecord[],
                nextCursor: input.watermark,
                done: true,
                provenance: null,
            };
        }

        this.loadTags();
        const allTags = this.sortedTags!;

        // ID-based 分页：取 id > cursor 的前 PAGE_SIZE 条
        const startIdx = allTags.findIndex(t => t.id > input.cursor);
        if (startIdx < 0) {
            return {
                resource: "tags",
                records: [],
                nextCursor: input.watermark,
                done: true,
                provenance: null,
            };
        }

        const page = allTags.slice(startIdx, startIdx + PAGE_SIZE);
        const lastId = page[page.length - 1]!.id;
        const done = lastId >= input.watermark || startIdx + page.length >= allTags.length;

        const provenance = computeProvenance({
            resource: "tags",
            pass: input.pass ?? "source",
            records: page,
            cursorStart: input.cursor,
            cursorEnd: done ? input.watermark : lastId,
            watermark: input.watermark,
        });

        return {
            resource: "tags",
            records: page,
            nextCursor: done ? input.watermark : lastId,
            done,
            provenance,
        };
    }
}

/**
 * 按优先级查找 TTP tagData 目录：
 *  1. 环境变量 TTP_TAGDATA_DIR（本地调试覆盖）
 *  2. 随应用打包的 Bundled Workspace Template：<system .nbook>/cache/text-to-image/ttp-tagdata
 *  3. 项目根下的 .agent/st-chatu8/tagData（开发环境克隆的上游仓库）
 */
export function resolveTtpTagDataDir(): string | null {
    const candidates: Array<string | undefined> = [process.env.TTP_TAGDATA_DIR];
    try {
        candidates.push(path.join(resolveSystemNbookRoot(), "cache", "text-to-image", "ttp-tagdata"));
    } catch {
        // system .nbook 不可解析时继续尝试开发环境路径
    }
    candidates.push(path.resolve(process.cwd(), ".agent/st-chatu8/tagData"));

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}
