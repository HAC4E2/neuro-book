import type {TextToImageTagVocabularySource} from "nbook/app/stores/text-to-image";

export type ImportedTextToImageTagVocabularyEntry = {
    tag: string;
    translation: string;
    category: string;
    aliases: string[];
};

export type StoredTextToImageTagVocabularyEntry = ImportedTextToImageTagVocabularyEntry & {
    id: string;
    sourceId: string;
    sourceName: string;
    importedAt: string;
    tagLower: string;
    translationLower: string;
    searchText: string;
};

export type TextToImageTagVocabularySearchOptions = {
    sourceId?: string;
    limit?: number;
};

type JsonRecord = Record<string, unknown>;

const DB_NAME = "neuro-book-text-to-image-tag-vocabulary";
const DB_VERSION = 1;
const TAG_STORE = "tags";
const SOURCE_ALL_CACHE_KEY = "__all__";

let dbPromise: Promise<IDBDatabase> | null = null;
const entryCache = new Map<string, StoredTextToImageTagVocabularyEntry[]>();

/**
 * 解析 tagData / Danbooru / 普通 JSON 词库文件为统一 tag 条目。
 */
export function parseTextToImageTagVocabularyJson(data: unknown, sourceName = "tagData"): ImportedTextToImageTagVocabularyEntry[] {
    const directTagDataEntries = parseDirectTagDataShape(data);
    if (directTagDataEntries.length > 0) {
        return dedupeImportedEntries(directTagDataEntries);
    }

    const entries: ImportedTextToImageTagVocabularyEntry[] = [];
    collectVocabularyEntries(data, "", sourceName, entries);
    return dedupeImportedEntries(entries);
}

/**
 * 将解析出的 tag 条目保存到 IndexedDB。source 元数据仍由 Pinia 持久化。
 */
export async function saveTextToImageTagVocabularyEntries(source: TextToImageTagVocabularySource, entries: ImportedTextToImageTagVocabularyEntry[]): Promise<void> {
    const db = await openTextToImageTagVocabularyDb();
    const importedAt = source.importedAt || new Date().toISOString();
    const uniqueEntries = dedupeImportedEntries(entries);
    await runTagStoreTransaction(db, "readwrite", (store) => {
        deleteEntriesBySourceInStore(store, source.id, () => {
            for (const [index, entry] of uniqueEntries.entries()) {
                const storedEntry = createStoredEntry(source, entry, importedAt, index);
                store.put(storedEntry);
            }
        });
    });
    invalidateEntryCache();
}

/**
 * 删除某个词库来源的全部 tag 条目。
 */
export async function deleteTextToImageTagVocabularySourceEntries(sourceId: string): Promise<void> {
    const db = await openTextToImageTagVocabularyDb();
    await runTagStoreTransaction(db, "readwrite", (store) => {
        deleteEntriesBySourceInStore(store, sourceId, () => {});
    });
    invalidateEntryCache();
}

/**
 * 清空全部本地 tag 词库条目。
 */
export async function clearTextToImageTagVocabularyEntries(): Promise<void> {
    const db = await openTextToImageTagVocabularyDb();
    await runTagStoreTransaction(db, "readwrite", (store) => {
        store.clear();
    });
    invalidateEntryCache();
}

/**
 * 搜索本地 tag 词库；空 query 返回当前来源的前若干条。
 */
export async function searchTextToImageTagVocabulary(query: string, options: TextToImageTagVocabularySearchOptions = {}): Promise<StoredTextToImageTagVocabularyEntry[]> {
    const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 40)));
    const sourceId = options.sourceId?.trim() ?? "";
    const entries = await loadCachedEntries(sourceId);
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
        return entries.slice(0, limit);
    }

    const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
    return entries
        .map((entry) => ({entry, score: scoreEntry(entry, normalizedQuery, tokens)}))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.entry.tag.localeCompare(right.entry.tag))
        .slice(0, limit)
        .map((item) => item.entry);
}

function parseDirectTagDataShape(data: unknown): ImportedTextToImageTagVocabularyEntry[] {
    if (!isRecord(data) || !Array.isArray(data.tag_tags)) {
        return [];
    }
    const groupLookup = buildTagGroupLookup(data.tag_groups);
    return data.tag_tags
        .map((item, index) => normalizeVocabularyItem(item, `tag_${index + 1}`, readItemCategory(item, groupLookup)))
        .filter((entry): entry is ImportedTextToImageTagVocabularyEntry => Boolean(entry?.tag));
}

function collectVocabularyEntries(value: unknown, category: string, fallbackName: string, entries: ImportedTextToImageTagVocabularyEntry[]): void {
    if (typeof value === "string") {
        const tag = normalizeTagText(value);
        if (tag) {
            entries.push({tag, translation: "", category, aliases: []});
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            const normalized = normalizeVocabularyItem(item, `${fallbackName}_${index + 1}`, category);
            if (normalized) {
                entries.push(normalized);
                continue;
            }
            collectVocabularyEntries(item, category, `${fallbackName}_${index + 1}`, entries);
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }

    const normalized = normalizeVocabularyItem(value, fallbackName, category);
    if (normalized) {
        entries.push(normalized);
    }

    for (const [key, child] of Object.entries(value)) {
        if (isMetadataKey(key)) {
            continue;
        }
        if (isContainerKey(key)) {
            collectVocabularyEntries(child, category, key, entries);
            continue;
        }
        const nextCategory = combineCategory(category, key);
        if (typeof child === "string") {
            const tag = normalizeTagText(key);
            if (tag) {
                entries.push({
                    tag,
                    translation: child.trim(),
                    category,
                    aliases: [],
                });
            }
            continue;
        }
        collectVocabularyEntries(child, nextCategory, key, entries);
    }
}

function normalizeVocabularyItem(value: unknown, fallbackTag: string, category: string): ImportedTextToImageTagVocabularyEntry | null {
    if (typeof value === "string") {
        const tag = normalizeTagText(value);
        return tag ? {tag, translation: "", category, aliases: []} : null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const hasExplicitTagField = ["tag", "text", "value", "en", "english", "name"].some((key) => typeof value[key] === "string");
    const tag = normalizeTagText(
        readFirstString(value, ["tag", "text", "value", "en", "english", "prompt"])
        || (hasMeaningfulNameTag(value) ? readFirstString(value, ["name"]) : "")
        || fallbackTag,
    );
    if (!tag || (!hasExplicitTagField && !readFirstString(value, ["translation", "translate", "zh", "cn", "chinese"]))) {
        return null;
    }
    return {
        tag,
        translation: readFirstString(value, ["translation", "translate", "zh", "cn", "chinese", "label", "description", "desc"]),
        category: readFirstString(value, ["category", "groupName", "group_name", "type", "kind"]) || category,
        aliases: readStringArray(value.aliases ?? value.alias ?? value.synonyms ?? value.search),
    };
}

function hasMeaningfulNameTag(value: JsonRecord): boolean {
    return Boolean(
        readFirstString(value, ["translation", "translate", "zh", "cn", "chinese", "category", "type"])
        || Array.isArray(value.aliases)
        || typeof value.alias === "string",
    );
}

function buildTagGroupLookup(value: unknown): Map<string, string> {
    const lookup = new Map<string, string>();
    if (!Array.isArray(value)) {
        return lookup;
    }
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)) {
            continue;
        }
        const id = readFirstString(item, ["id", "key", "value", "group", "groupId", "group_id"]) || String(index);
        const name = readFirstString(item, ["name", "text", "label", "translation", "title"]) || id;
        lookup.set(id, name);
    }
    return lookup;
}

function readItemCategory(value: unknown, groupLookup: Map<string, string>): string {
    if (!isRecord(value)) {
        return "";
    }
    const direct = readFirstString(value, ["category", "groupName", "group_name", "type", "kind"]);
    if (direct) {
        return direct;
    }
    const groupId = readFirstString(value, ["group", "groupId", "group_id", "tagGroup", "tag_group"]);
    return groupId ? groupLookup.get(groupId) ?? groupId : "";
}

function dedupeImportedEntries(entries: ImportedTextToImageTagVocabularyEntry[]): ImportedTextToImageTagVocabularyEntry[] {
    const seen = new Set<string>();
    const result: ImportedTextToImageTagVocabularyEntry[] = [];
    for (const entry of entries) {
        const tag = normalizeTagText(entry.tag);
        if (!tag) {
            continue;
        }
        const normalized: ImportedTextToImageTagVocabularyEntry = {
            tag,
            translation: entry.translation.trim(),
            category: entry.category.trim(),
            aliases: Array.from(new Set(entry.aliases.map((alias) => alias.trim()).filter(Boolean))),
        };
        const key = `${normalized.tag.toLowerCase()}\n${normalized.translation}\n${normalized.category}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(normalized);
    }
    return result;
}

function createStoredEntry(source: TextToImageTagVocabularySource, entry: ImportedTextToImageTagVocabularyEntry, importedAt: string, index: number): StoredTextToImageTagVocabularyEntry {
    const searchParts = [entry.tag, entry.translation, entry.category, ...entry.aliases];
    const searchText = normalizeSearchText(searchParts.join(" "));
    return {
        ...entry,
        id: `${source.id}:${index}:${hashString(`${entry.tag}\n${entry.translation}\n${entry.category}`)}`,
        sourceId: source.id,
        sourceName: source.name,
        importedAt,
        tagLower: entry.tag.toLowerCase(),
        translationLower: entry.translation.toLowerCase(),
        searchText,
    };
}

function scoreEntry(entry: StoredTextToImageTagVocabularyEntry, query: string, tokens: string[]): number {
    if (!tokens.every((token) => entry.searchText.includes(token))) {
        return 0;
    }
    let score = 1;
    if (entry.tagLower === query) {
        score += 100;
    } else if (entry.tagLower.startsWith(query)) {
        score += 60;
    } else if (entry.tagLower.includes(query)) {
        score += 35;
    }
    if (entry.translationLower === query) {
        score += 80;
    } else if (entry.translationLower.startsWith(query)) {
        score += 45;
    } else if (entry.translationLower.includes(query)) {
        score += 25;
    }
    return score;
}

async function loadCachedEntries(sourceId: string): Promise<StoredTextToImageTagVocabularyEntry[]> {
    const cacheKey = sourceId || SOURCE_ALL_CACHE_KEY;
    const cached = entryCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const db = await openTextToImageTagVocabularyDb();
    const entries = await runReadonlyTagStore(db, (store) => {
        if (!sourceId) {
            return requestToPromise<StoredTextToImageTagVocabularyEntry[]>(store.getAll());
        }
        return requestToPromise<StoredTextToImageTagVocabularyEntry[]>(store.index("sourceId").getAll(sourceId));
    });
    entryCache.set(cacheKey, entries);
    return entries;
}

function openTextToImageTagVocabularyDb(): Promise<IDBDatabase> {
    if (dbPromise) {
        return dbPromise;
    }
    if (typeof indexedDB === "undefined") {
        throw new Error("当前环境不支持本地 IndexedDB 词库");
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.objectStoreNames.contains(TAG_STORE)
                ? request.transaction?.objectStore(TAG_STORE)
                : db.createObjectStore(TAG_STORE, {keyPath: "id"});
            if (!store) {
                return;
            }
            createIndexIfMissing(store, "sourceId", "sourceId");
            createIndexIfMissing(store, "tagLower", "tagLower");
            createIndexIfMissing(store, "translationLower", "translationLower");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("打开本地 tag 词库失败"));
    });
    return dbPromise;
}

function runTagStoreTransaction(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(TAG_STORE, mode);
        const store = transaction.objectStore(TAG_STORE);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("写入本地 tag 词库失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("写入本地 tag 词库已中止"));
        run(store);
    });
}

function runReadonlyTagStore<T>(db: IDBDatabase, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const transaction = db.transaction(TAG_STORE, "readonly");
    const store = transaction.objectStore(TAG_STORE);
    return run(store);
}

function deleteEntriesBySourceInStore(store: IDBObjectStore, sourceId: string, afterDelete: () => void): void {
    const request = store.index("sourceId").openCursor(IDBKeyRange.only(sourceId));
    request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
        }
        afterDelete();
    };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("读取本地 tag 词库失败"));
    });
}

function createIndexIfMissing(store: IDBObjectStore, name: string, keyPath: string): void {
    if (!store.indexNames.contains(name)) {
        store.createIndex(name, keyPath, {unique: false});
    }
}

function invalidateEntryCache(): void {
    entryCache.clear();
}

function readFirstString(record: JsonRecord, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return "";
}

function readStringArray(value: unknown): string[] {
    if (typeof value === "string") {
        return value.split(/[,，/|]/u).map((item) => item.trim()).filter(Boolean);
    }
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => typeof item === "string" ? readStringArray(item) : []);
}

function normalizeTagText(value: string): string {
    return value.trim().replace(/\s+/gu, " ");
}

function normalizeSearchText(value: string): string {
    return value.trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

function combineCategory(parent: string, child: string): string {
    const normalizedChild = child.trim();
    if (!parent) {
        return normalizedChild;
    }
    if (!normalizedChild || parent.includes(normalizedChild)) {
        return parent;
    }
    return `${parent} / ${normalizedChild}`;
}

function isContainerKey(key: string): boolean {
    return ["tags", "tag_tags", "items", "data", "children", "entries", "list", "values"].includes(key);
}

function isMetadataKey(key: string): boolean {
    return [
        "tag_groups",
        "version",
        "name",
        "title",
        "description",
        "updated_at",
        "updatedAt",
        "created_at",
        "createdAt",
    ].includes(key);
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
