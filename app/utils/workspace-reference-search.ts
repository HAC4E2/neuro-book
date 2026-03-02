import Fuse from "fuse.js";
import {pinyin} from "pinyin-pro";

export interface WorkspaceReferenceSearchInput<TItem> {
    item: TItem;
    label: string;
    target: string;
    description?: string;
    entryType?: string | null;
    menuId?: string;
    frontmatter?: Record<string, unknown>;
    order: number;
}

export interface WorkspaceReferenceSearchResult<TItem> {
    item: TItem;
    score: number;
    order: number;
}

interface SearchRecord<TItem> {
    input: WorkspaceReferenceSearchInput<TItem>;
    label: string;
    target: string;
    description: string;
    entryType: string;
    menuId: string;
    ids: string;
    compact: string;
    pinyinText: string;
    pinyinInitials: string;
    order: number;
}

const PATH_SEPARATOR_PATTERN = /[\/\\\s:_\-：.]+/g;

/**
 * 构造 workspace 引用的候选路径。
 */
export function collectWorkspaceReferencePathCandidates(target: string, currentWorkspaceRoot = ""): string[] {
    const normalizedTarget = normalizeWorkspacePath(target);
    const normalizedCurrentRoot = normalizeWorkspacePath(currentWorkspaceRoot);
    const baseTargets = new Set<string>([normalizedTarget]);
    if (normalizedCurrentRoot && (
        normalizedTarget === normalizedCurrentRoot
        || normalizedTarget.startsWith(`${normalizedCurrentRoot}/`)
    )) {
        const relativeTarget = normalizedTarget === normalizedCurrentRoot
            ? "."
            : normalizedTarget.slice(normalizedCurrentRoot.length + 1);
        baseTargets.add(relativeTarget);
    }

    const candidates = new Set<string>();
    for (const baseTarget of baseTargets) {
        addWorkspaceReferencePathCandidates(candidates, baseTarget);
    }
    return [...candidates].map(normalizeWorkspacePath);
}

/**
 * 搜索 workspace 引用候选。面向路径、中文拼音、拼音首字母和轻微输入错误。
 */
export function searchWorkspaceReferences<TItem>(
    inputs: Array<WorkspaceReferenceSearchInput<TItem>>,
    query: string,
    limit = 40,
): Array<WorkspaceReferenceSearchResult<TItem>> {
    const normalizedQuery = normalizeSearchText(query);
    const records = inputs.map(createSearchRecord);
    if (!normalizedQuery) {
        return records.slice(0, limit).map((record) => ({
            item: record.input.item,
            score: 0,
            order: record.order,
        }));
    }

    const scored = new Map<TItem, WorkspaceReferenceSearchResult<TItem>>();
    for (const record of records) {
        const score = deterministicScore(record, normalizedQuery);
        if (score < Number.POSITIVE_INFINITY) {
            scored.set(record.input.item, {
                item: record.input.item,
                score,
                order: record.order,
            });
        }
    }

    const fuse = new Fuse(records, {
        includeScore: true,
        threshold: 0.42,
        ignoreLocation: true,
        keys: [
            {name: "label", weight: 0.9},
            {name: "target", weight: 0.9},
            {name: "compact", weight: 1},
            {name: "pinyinText", weight: 0.75},
            {name: "pinyinInitials", weight: 0.65},
            {name: "ids", weight: 1},
            {name: "description", weight: 0.35},
            {name: "entryType", weight: 0.25},
        ],
    });

    for (const result of fuse.search(normalizedQuery)) {
        const record = result.item;
        const score = 80 + Math.round((result.score ?? 1) * 100);
        const existing = scored.get(record.input.item);
        if (!existing || score < existing.score) {
            scored.set(record.input.item, {
                item: record.input.item,
                score,
                order: record.order,
            });
        }
    }

    return [...scored.values()]
        .sort((left, right) => left.score - right.score || left.order - right.order)
        .slice(0, limit);
}

/**
 * 将一个基础 target 展开为文件、目录、index.md 和内容根候选。
 */
function addWorkspaceReferencePathCandidates(candidates: Set<string>, target: string): void {
    const normalizedTarget = normalizeWorkspacePath(target);
    candidates.add(normalizedTarget);
    candidates.add(`${normalizedTarget}/`);
    if (normalizedTarget.endsWith("/index.md")) {
        candidates.add(normalizedTarget.slice(0, -"/index.md".length));
    } else {
        candidates.add(`${normalizedTarget}/index.md`);
    }
    if (!normalizedTarget.startsWith("lorebook/") && !normalizedTarget.startsWith("manuscript/")) {
        candidates.add(`lorebook/${normalizedTarget}`);
        candidates.add(`lorebook/${normalizedTarget}/`);
        candidates.add(`lorebook/${normalizedTarget}/index.md`);
        candidates.add(`manuscript/${normalizedTarget}`);
        candidates.add(`manuscript/${normalizedTarget}/`);
        candidates.add(`manuscript/${normalizedTarget}/index.md`);
    }
}

/**
 * 标准化 workspace 路径。
 */
function normalizeWorkspacePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
}

/**
 * 构造用于搜索的多字段记录。
 */
function createSearchRecord<TItem>(input: WorkspaceReferenceSearchInput<TItem>): SearchRecord<TItem> {
    const rawText = [
        input.label,
        input.target,
        input.description ?? "",
        input.entryType ?? "",
        readSearchableIds(input),
    ].join(" ");
    const compact = compactSearchText(rawText);
    return {
        input,
        label: normalizeSearchText(input.label),
        target: normalizeSearchText(input.target),
        description: normalizeSearchText(input.description ?? ""),
        entryType: normalizeSearchText(input.entryType ?? ""),
        menuId: normalizeSearchText(input.menuId ?? ""),
        ids: normalizeSearchText(readSearchableIds(input)),
        compact,
        pinyinText: compactSearchText(toPinyin(rawText, false)),
        pinyinInitials: compactSearchText(toPinyin(rawText, true)),
        order: input.order,
    };
}

/**
 * 计算确定性分数。数字越小越相关。
 */
function deterministicScore<TItem>(record: SearchRecord<TItem>, query: string): number {
    const compactQuery = compactSearchText(query);
    const candidates: Array<[string, number]> = [
        [record.label, 0],
        [record.target, 5],
        [record.ids, 8],
        [record.compact, 14],
        [record.pinyinText, 28],
        [record.pinyinInitials, 36],
        [record.description, 52],
        [record.entryType, 60],
        [record.menuId, 64],
    ];

    let bestScore = Number.POSITIVE_INFINITY;
    for (const [value, baseScore] of candidates) {
        if (!value) {
            continue;
        }
        if (value === query || value === compactQuery) {
            bestScore = Math.min(bestScore, baseScore);
        } else if (value.startsWith(query) || value.startsWith(compactQuery)) {
            bestScore = Math.min(bestScore, baseScore + 2);
        } else if (value.includes(query) || value.includes(compactQuery)) {
            bestScore = Math.min(bestScore, baseScore + 8);
        } else if (isSubsequence(compactQuery, value)) {
            bestScore = Math.min(bestScore, baseScore + 18);
        }
    }
    return bestScore;
}

/**
 * 读取可搜索 id 字段。
 */
function readSearchableIds<TItem>(input: WorkspaceReferenceSearchInput<TItem>): string {
    const frontmatter = input.frontmatter ?? {};
    return [
        input.menuId ?? "",
        stringifySearchValue(frontmatter.id),
        stringifySearchValue(frontmatter.uid),
    ].filter(Boolean).join(" ");
}

/**
 * 标准化搜索文本。
 */
function normalizeSearchText(value: string): string {
    return value.trim().toLocaleLowerCase("zh-CN");
}

/**
 * 去掉常见路径和标点分隔符，形成连续匹配字段。
 */
function compactSearchText(value: string): string {
    return normalizeSearchText(value).replace(PATH_SEPARATOR_PATTERN, "");
}

/**
 * 转换中文拼音。首字母模式用于 nh/nhsj 这类缩写。
 */
function toPinyin(value: string, initials: boolean): string {
    if (initials) {
        return pinyin(value, {
            toneType: "none",
            type: "array",
            pattern: "first",
            nonZh: "consecutive",
        }).join("");
    }
    return pinyin(value, {
        toneType: "none",
        type: "string",
        pattern: "pinyin",
        nonZh: "consecutive",
    });
}

/**
 * 判断 query 是否按顺序出现在 candidate 中。
 */
function isSubsequence(query: string, candidate: string): boolean {
    if (!query) {
        return true;
    }
    let queryIndex = 0;
    for (const char of candidate) {
        if (char === query[queryIndex]) {
            queryIndex += 1;
            if (queryIndex === query.length) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 把 frontmatter id 转成搜索文本。
 */
function stringifySearchValue(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") {
        return String(value);
    }
    return "";
}
