import {consola} from "consola";
import {createError, getHeader, isError, readBody, type H3Event} from "h3";
import getRawBody from "raw-body";
import type {
    NovelListItemDto,
    UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import type {ServerTimingSink} from "nbook/server/utils/server-timing";
import {YAMLParseError} from "yaml";
import {z} from "zod";
import {
    assertProjectWorkspaceDirectory,
    listProjectWorkspaces,
    readProjectManifest,
    writeProjectManifest,
    type ProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/**
 * Project 列表只读取 manifest。
 *
 * 这里刻意不做任何内容统计：列表请求不得成为 Project Workspace File Index、
 * Project SQLite 或 Agent session store 的持有者，否则一次书架刷新就会把全部
 * Project 的文件树扫描和数据库连接拖起来。
 */
type NovelListOptions = {
    timingSink?: ServerTimingSink;
    diagnostics?: NovelListDiagnostics;
};

export type NovelListCacheStatus = "hit" | "miss" | "pending";

export type NovelListDiagnostics = {
    projectListCache?: NovelListCacheStatus;
    projectCount?: number;
};

const NOVEL_LIST_CACHE_TTL_MS = 5_000;
let defaultProjectListCacheVersion = 0;
let defaultProjectListCache: {expiresAt: number; value: Awaited<ReturnType<typeof listProjectWorkspaces>>} | null = null;
let defaultProjectListPromise: Promise<Awaited<ReturnType<typeof listProjectWorkspaces>>> | null = null;

type EntityIdLabel =
    | "storyId"
    | "phaseId"
    | "threadId"
    | "sceneId"
    | "plotId"
    | "actId"
    | "chapterId"
    | "promiseId"
    | "decisionId"
    | "entryId"
    | "parentId";

/**
 * 将数据库整数 ID 转成对外字符串。
 */
export function stringifyEntityId(id: number): string {
    return String(id);
}

/**
 * 将外部传入的 ID 解析为数据库整数。
 */
export function parseEntityId(label: EntityIdLabel, value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throwBadRequest(`${label} 不能为空`);
    }

    if (!/^\d+$/.test(normalized)) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    const parsedId = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    return parsedId;
}

/**
 * 将可空 ID 解析为数据库整数。
 * 空值表示客户端未提供该字段。
 */
export function parseNullableEntityId(label: EntityIdLabel, value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return parseEntityId(label, value);
}

/**
 * 抛出 400。
 */
const throwBadRequest = (message: string): never => {
    throw createError({
        statusCode: 400,
        message,
    });
};

/**
 * 将 Project manifest 映射为兼容现有前端的小说列表项。
 */
export function toNovelResponse(project: {
    projectPath: string;
    title: string;
    summary: string;
    updatedAt: string;
    manifestError?: string;
}): NovelListItemDto {
    const workspaceSlug = project.projectPath.split("/").at(-1) ?? project.projectPath;
    return {
        id: project.projectPath,
        title: project.title,
        summary: project.summary,
        workspaceSlug,
        projectPath: project.projectPath,
        manifestError: project.manifestError,
        createdAt: project.updatedAt,
        updatedAt: project.updatedAt,
    };
}

/**
 * 获取 Project Workspace 列表。
 *
 * 只读 manifest 并直接映射为 DTO；不扫描文件树、不打开 Project SQLite、不读取
 * Agent session store。列表不做裁剪，调用方需要过滤时在自己那侧筛选。
 */
export async function listNovels(options: NovelListOptions = {}): Promise<NovelListItemDto[]> {
    const startedAt = performance.now();
    options.diagnostics ??= {};
    try {
        const projects = await readCachedProjectList(options);
        options.diagnostics.projectCount = projects.length;
        return projects.map((project) => toNovelResponse(project));
    } finally {
        options.timingSink?.mark("projects.total", performance.now() - startedAt);
    }
}

/**
 * 失效 Project Workspace 列表短缓存。
 */
export function invalidateNovelListCache(): void {
    defaultProjectListCacheVersion += 1;
    defaultProjectListCache = null;
    defaultProjectListPromise = null;
}

/**
 * 读取带短缓存的 Project manifest 列表。
 *
 * 这是 Project 列表唯一的运行时缓存：它只覆盖 manifest 读取，不缓存任何统计，
 * 因此失效后重建的代价只是重新读一遍 project.yaml。
 */
async function readCachedProjectList(options: NovelListOptions): Promise<Awaited<ReturnType<typeof listProjectWorkspaces>>> {
    const now = Date.now();
    if (defaultProjectListCache && defaultProjectListCache.expiresAt > now) {
        options.diagnostics!.projectListCache = "hit";
        options.timingSink?.mark("projects.manifests", 0);
        return defaultProjectListCache.value;
    }
    if (defaultProjectListPromise) {
        options.diagnostics!.projectListCache = "pending";
        return measureAsync(options.timingSink, "projects.manifests", () => defaultProjectListPromise!);
    }

    options.diagnostics!.projectListCache = "miss";
    const cacheVersion = defaultProjectListCacheVersion;
    const workspaceRoot = resolveRuntimeWorkspaceRoot();
    defaultProjectListPromise = measureAsync(options.timingSink, "projects.manifests", () => listProjectWorkspaces(workspaceRoot))
        .then((projects) => {
            if (cacheVersion === defaultProjectListCacheVersion) {
                defaultProjectListCache = {
                    expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
                    value: projects,
                };
            }
            return projects;
        })
        .finally(() => {
            if (cacheVersion === defaultProjectListCacheVersion) {
                defaultProjectListPromise = null;
            }
        });
    return defaultProjectListPromise;
}

/**
 * 校验 Project Workspace 存在。
 */
export async function assertNovel(projectPath: string): Promise<NovelListItemDto> {
    const manifest = await readProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath);
    return toNovelResponse({
        projectPath,
        title: manifest.title,
        summary: manifest.summary,
        updatedAt: new Date().toISOString(),
    });
}

async function measureAsync<T>(timingSink: ServerTimingSink | undefined, name: string, task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
        return await task();
    } finally {
        timingSink?.mark(name, performance.now() - startedAt);
    }
}

/**
 * 读取 projectPath 路由参数。
 */
export function requireProjectPath(event: H3Event): string {
    const value = event.context.params?.projectPath ?? event.context.params?.novelId ?? "";
    if (!value.trim()) {
        throwBadRequest("projectPath 不能为空");
    }
    return decodeURIComponent(value);
}

/**
 * 读取 query 中的 projectPath。
 */
export function requireProjectPathQuery(event: H3Event): string {
    const query = getQuery(event);
    const value = query.projectPath;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        throwBadRequest("projectPath query 不能为空");
    }
    return text;
}

/**
 * 统一校验请求体。
 */
export async function validateBody<T>(
    event: H3Event,
    schema: z.ZodSchema<T>,
    options: {maxBytes?: number} = {},
): Promise<T> {
    let body: unknown;
    if (options.maxBytes === undefined) {
        body = await readBody(event);
    } else {
        const contentLength = getHeader(event, "content-length");
        if (contentLength && Number(contentLength) > options.maxBytes) {
            throw createError({
                statusCode: 413,
                message: "请求体超过允许大小",
                data: {code: "REQUEST_BODY_TOO_LARGE"},
            });
        }
        let raw: string;
        try {
            raw = await getRawBody(event.node.req, {
                length: contentLength,
                limit: options.maxBytes,
                encoding: "utf8",
            });
        } catch (error) {
            const rawError = error as {statusCode?: number; type?: string};
            if (rawError.statusCode === 413 || rawError.type === "entity.too.large") {
                throw createError({
                    statusCode: 413,
                    message: "请求体超过允许大小",
                    data: {code: "REQUEST_BODY_TOO_LARGE"},
                });
            }
            throw error;
        }
        try {
            body = JSON.parse(raw) as unknown;
        } catch {
            throw createError({statusCode: 400, message: "请求体必须是有效 JSON"});
        }
    }
    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        consola.warn({
            method: event.method,
            path: event.path,
            issues: parseResult.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path,
                message: issue.message,
            })),
        }, "请求体验证失败");
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
}

/**
 * 更新 Project manifest 基础信息。
 */
export async function updateNovelByTool(
    projectPath: string,
    input: UpdateNovelRequestDto,
): Promise<NovelListItemDto> {
    const workspaceRoot = resolveRuntimeWorkspaceRoot();
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(workspaceRoot, projectPath);
    const current = await readProjectManifestOrFallback(workspaceRoot, normalizedProjectPath);
    const next = {
        ...current,
        title: input.title ?? current.title,
        summary: input.summary ?? current.summary,
    };
    await writeProjectManifest(workspaceRoot, normalizedProjectPath, next);
    return toNovelResponse({
        projectPath: normalizedProjectPath,
        title: next.title,
        summary: next.summary,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * 读取 Project Manifest；若文件已损坏，使用目录名兜底，让元数据更新可以覆盖写回合法 manifest。
 */
async function readProjectManifestOrFallback(workspaceRoot: AbsoluteFsPath, projectPath: string): Promise<ProjectManifest> {
    try {
        return await readProjectManifest(workspaceRoot, projectPath);
    } catch (error) {
        if (!isRecoverableProjectManifestError(error)) {
            throw error;
        }
        return {
            kind: "novel",
            title: projectPath.split("/").at(-1) ?? projectPath,
            summary: "",
        };
    }
}

/**
 * 判断 Project Manifest 读取错误是否可以由覆盖写回修复。
 */
function isRecoverableProjectManifestError(error: unknown): boolean {
    if (error instanceof YAMLParseError) {
        return true;
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return true;
    }
    if (isError(error) && error.statusCode === 400) {
        return true;
    }
    return false;
}
