import {z} from "zod";
import {
    TAG_INDEX_SOURCE_ENDPOINT,
    TAG_INDEX_SOURCE_KIND,
    TagIndexSourcePassSchema,
    TagIndexSourceResourceSchema,
    type TagIndexPageProvenance,
} from "nbook/shared/text-to-image-tag-index";

export type TagSourceResource = z.infer<typeof TagIndexSourceResourceSchema>;
export type TagSourcePass = z.infer<typeof TagIndexSourcePassSchema>;

/**
 * Danbooru schema 的 tag 记录投影。
 * 本地 TTP tagData 同样以 Danbooru 衍生 schema 提供数据，因此记录形状保持不变。
 */
export type DanbooruTagSourceRecord = {
    id: number;
    name: string;
    categoryId: 0 | 1 | 3 | 4 | 5;
    postCount: number;
    isDeprecated: boolean;
    createdAt: string;
    updatedAt: string;
};

export type DanbooruRelationshipSourceRecord = {
    id: number;
    antecedentName: string;
    consequentName: string;
    createdAt: string;
    updatedAt: string;
};

export type TagSourceTagPage = {
    resource: "tags";
    records: DanbooruTagSourceRecord[];
    nextCursor: number;
    done: boolean;
    /** 过滤 watermark 后无记录的结束页不生成可缓存 page。 */
    provenance: TagIndexPageProvenance | null;
};

export type TagSourceRelationshipPage = {
    resource: "aliases" | "implications";
    records: DanbooruRelationshipSourceRecord[];
    nextCursor: number;
    done: boolean;
    /** 过滤 watermark 后无记录的结束页不生成可缓存 page。 */
    provenance: TagIndexPageProvenance | null;
};

export type TagSourcePage = TagSourceTagPage | TagSourceRelationshipPage;

export type TagSourcePageInput = {
    resource: TagSourceResource;
    pass: TagSourcePass;
    cursor: number;
    watermark: number;
    signal?: AbortSignal;
};

export type TagSourceRetry = {
    reason: "network_error" | "rate_limited" | "server_error";
    attempt: number;
    delayMs: number;
};

/** source client 的身份与能力声明；进入 snapshot/manifest 溯源真相。 */
export type TagSourceDescriptor = {
    kind: typeof TAG_INDEX_SOURCE_KIND;
    endpoint: typeof TAG_INDEX_SOURCE_ENDPOINT;
    clientVersion: string;
    /** 显式声明提供哪些资源；未声明资源在同步/builder 中必须零记录、零 page。 */
    providedResources: readonly TagSourceResource[];
};

/** 可由生产 client 或 deterministic fixture 实现的最小同步读取面。 */
export type TagSourceReader = {
    readonly descriptor: TagSourceDescriptor;
    readWatermark(resource: TagSourceResource, signal?: AbortSignal): Promise<number>;
    readPage(input: TagSourcePageInput): Promise<TagSourcePage>;
};
