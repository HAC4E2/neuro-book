import {readFileSync, statSync} from "node:fs";
import {readFile, readdir, stat, writeFile} from "node:fs/promises";
import {basename, isAbsolute, join, relative, resolve} from "node:path";
import {createError} from "h3";
import {
    parseSubjectEvent,
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
    parseSubjectMemory,
    serializeSubjectEventsJsonl,
    serializeSubjectMemoriesJsonl,
    subjectMemorySourceHash,
    type SubjectEvent,
    type SubjectMemory,
} from "nbook/server/agent/tools/subject-memory";
import {
    markSubjectRagDirty,
    rebuildSubjectRag,
    searchSubjectRag,
    type SubjectPaths,
    type SubjectRagSourceType,
} from "nbook/server/agent/tools/subject-rag-index";
import {normalizeProjectPath, resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {WORKSPACE_CONTAINER_ROOT} from "nbook/server/workspace-files/novel-workspace";
import type {
    ProjectRagEventDeleteRequestDto,
    ProjectRagEventReorderRequestDto,
    ProjectRagEventWriteRequestDto,
    ProjectRagIndexStatusDto,
    ProjectRagMemoryDeleteRequestDto,
    ProjectRagMemoryWriteRequestDto,
    ProjectRagOverviewDto,
    ProjectRagRebuildRequestDto,
    ProjectRagRebuildResultDto,
    ProjectRagSearchRequestDto,
    ProjectRagSearchResultDto,
    ProjectRagSourceStatusDto,
    ProjectRagSubjectDto,
    ProjectRagSubjectSummaryDto,
} from "nbook/shared/dto/project-rag.dto";

type SourceError = {
    source: SubjectRagSourceType;
    message: string;
};

const RAG_SOURCES: SubjectRagSourceType[] = ["events", "memory"];

type ReadonlySqliteDatabase = {
    query(sql: string): {
        all(...params: unknown[]): unknown[];
    };
    close(): void;
};

type BunSqliteModule = {
    Database: new (path: string, options?: {readonly?: boolean}) => ReadonlySqliteDatabase;
};

type NodeSqliteDatabase = {
    prepare(sql: string): {
        all(...params: unknown[]): unknown[];
    };
    close(): void;
};

type NodeSqliteModule = {
    DatabaseSync: new (path: string, options?: {readOnly?: boolean}) => NodeSqliteDatabase;
};

/**
 * 读取当前 Project 的 RAG subject 概览。
 */
export async function readProjectRagOverview(projectPathInput: string): Promise<ProjectRagOverviewDto> {
    const project = resolveProject(projectPathInput);
    const subjects = await listSubjectPaths(project.root);
    const summaries = await Promise.all(subjects.map((subjectPath) => readSubjectSummary(project, subjectPath)));
    return {
        projectPath: project.projectPath,
        subjects: summaries,
    };
}

/**
 * 读取单个 subject 的 events / memory 展示数据。
 */
export async function readProjectRagSubject(projectPathInput: string, subjectPathInput: string): Promise<ProjectRagSubjectDto> {
    const project = resolveProject(projectPathInput);
    const subject = resolveSubject(project, subjectPathInput);
    const [eventsResult, memoriesResult, sourceStatuses] = await Promise.all([
        readEvents(subject.paths.eventsPath),
        readMemories(subject.paths.memoryPath),
        readSourceStatuses(project.root, subject.paths),
    ]);
    return {
        projectPath: project.projectPath,
        subjectPath: subject.subjectPath,
        subjectId: subject.subjectId,
        events: eventsResult.events.map((event, index) => ({
            line: index + 1,
            ...event,
        })),
        memories: memoriesResult.memories.map((memory, index) => ({
            line: index + 1,
            ...memory,
        })),
        sourceStatuses,
        errors: [...eventsResult.errors, ...memoriesResult.errors],
    };
}

/**
 * 在当前 subject 上执行真实 RAG 搜索。
 */
export async function searchProjectSubjectRag(projectPathInput: string, input: ProjectRagSearchRequestDto): Promise<ProjectRagSearchResultDto> {
    const project = resolveProject(projectPathInput);
    const subject = resolveSubject(project, input.subjectPath);
    ensureSubjectSourcesReadable(subject.paths, input.sources?.length ? input.sources : RAG_SOURCES);
    const candidates = await searchSubjectRag({
        context: {
            workspaceRoot: WORKSPACE_CONTAINER_ROOT,
            projectPath: project.projectPath,
        },
        subject: subject.paths,
        query: input.query,
        sources: input.sources?.length ? input.sources : RAG_SOURCES,
        limit: input.limit ?? 10,
    });
    return {
        projectPath: project.projectPath,
        subjectPath: subject.subjectPath,
        candidates,
    };
}

/**
 * 重建当前 subject 或当前 Project 的 RAG 索引。
 */
export async function rebuildProjectSubjectRag(projectPathInput: string, input: ProjectRagRebuildRequestDto): Promise<ProjectRagRebuildResultDto> {
    const project = resolveProject(projectPathInput);
    const subjectPaths = input.subjectPath ? [input.subjectPath] : await listSubjectPaths(project.root);
    const results: ProjectRagRebuildResultDto["results"] = [];
    let rebuiltSubjects = 0;
    let skippedSubjects = 0;
    for (const subjectPath of subjectPaths) {
        try {
            const subject = resolveSubject(project, subjectPath);
            ensureSubjectSourcesReadable(subject.paths, RAG_SOURCES);
            await rebuildSubjectRag({
                context: {
                    workspaceRoot: WORKSPACE_CONTAINER_ROOT,
                    projectPath: project.projectPath,
                },
                subject: subject.paths,
                sources: RAG_SOURCES,
            });
            rebuiltSubjects += 1;
            results.push({subjectPath: subject.subjectPath, ok: true, message: null});
        } catch (error) {
            skippedSubjects += 1;
            results.push({
                subjectPath,
                ok: false,
                message: errorMessage(error),
            });
        }
    }
    return {
        projectPath: project.projectPath,
        rebuiltSubjects,
        skippedSubjects,
        results,
    };
}

/**
 * 新增一条 subject event。
 */
export async function createProjectRagEvent(projectPath: string, input: ProjectRagEventWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const events = parseEventsForWrite(subject.paths.eventsPath);
    events.push(parseSubjectEvent(input.event, "event"));
    await writeEventsAndMarkDirty(subject.paths, events);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 修改一条 subject event。
 */
export async function updateProjectRagEvent(projectPath: string, input: ProjectRagEventWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const index = requireIndex(input.index, "index");
    const events = parseEventsForWrite(subject.paths.eventsPath);
    assertArrayIndex(events, index, "event");
    events[index] = parseSubjectEvent(input.event, "event");
    await writeEventsAndMarkDirty(subject.paths, events);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 删除一条 subject event。
 */
export async function deleteProjectRagEvent(projectPath: string, input: ProjectRagEventDeleteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const events = parseEventsForWrite(subject.paths.eventsPath);
    assertArrayIndex(events, input.index, "event");
    events.splice(input.index, 1);
    await writeEventsAndMarkDirty(subject.paths, events);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 重排一条 subject event。
 */
export async function reorderProjectRagEvent(projectPath: string, input: ProjectRagEventReorderRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const events = parseEventsForWrite(subject.paths.eventsPath);
    assertArrayIndex(events, input.fromIndex, "event");
    assertArrayIndex(events, input.toIndex, "event");
    const [event] = events.splice(input.fromIndex, 1);
    if (event) {
        events.splice(input.toIndex, 0, event);
    }
    await writeEventsAndMarkDirty(subject.paths, events);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 新增一条 subject memory。
 */
export async function createProjectRagMemory(projectPath: string, input: ProjectRagMemoryWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const memories = parseMemoriesForWrite(subject.paths.memoryPath);
    const next = parseSubjectMemory(input.memory, "memory");
    if (memories.some((memory) => memory.topic === next.topic)) {
        throwConflict(`memory topic 已存在：${next.topic}`);
    }
    memories.push(next);
    await writeMemoriesAndMarkDirty(subject.paths, memories);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 修改一条 subject memory。旧 topic 用于定位，memory.topic 可用于改名。
 */
export async function updateProjectRagMemory(projectPath: string, input: ProjectRagMemoryWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const topic = input.topic?.trim();
    if (!topic) {
        throwBadRequest("topic 不能为空");
    }
    const memories = parseMemoriesForWrite(subject.paths.memoryPath);
    const index = memories.findIndex((memory) => memory.topic === topic);
    if (index < 0) {
        throwConflict(`memory topic 不存在：${topic}`);
    }
    const next = parseSubjectMemory(input.memory, "memory");
    if (next.topic !== topic && memories.some((memory) => memory.topic === next.topic)) {
        throwConflict(`memory topic 已存在：${next.topic}`);
    }
    memories[index] = next;
    await writeMemoriesAndMarkDirty(subject.paths, memories);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

/**
 * 删除一条 subject memory。
 */
export async function deleteProjectRagMemory(projectPath: string, input: ProjectRagMemoryDeleteRequestDto): Promise<ProjectRagSubjectDto> {
    const {project, subject} = resolveProjectSubject(projectPath, input.subjectPath);
    const memories = parseMemoriesForWrite(subject.paths.memoryPath);
    const index = memories.findIndex((memory) => memory.topic === input.topic);
    if (index < 0) {
        throwConflict(`memory topic 不存在：${input.topic}`);
    }
    memories.splice(index, 1);
    await writeMemoriesAndMarkDirty(subject.paths, memories);
    return readProjectRagSubject(project.projectPath, subject.subjectPath);
}

function resolveProjectSubject(projectPathInput: string, subjectPathInput: string): {
    project: ReturnType<typeof resolveProject>;
    subject: ReturnType<typeof resolveSubject>;
} {
    const project = resolveProject(projectPathInput);
    return {
        project,
        subject: resolveSubject(project, subjectPathInput),
    };
}

function resolveProject(projectPathInput: string): {
    projectPath: string;
    root: string;
} {
    const projectPath = normalizeProjectPath(projectPathInput);
    return {
        projectPath,
        root: resolveProjectAbsolutePath(projectPath),
    };
}

function resolveSubject(project: ReturnType<typeof resolveProject>, subjectPathInput: string): {
    subjectPath: string;
    subjectId: string;
    paths: SubjectPaths;
} {
    const subjectPath = normalizeSubjectPath(subjectPathInput);
    const absolutePath = resolve(project.root, subjectPath);
    const relativePath = relative(project.root, absolutePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throwBadRequest("subjectPath 越界");
    }
    assertSubjectDirectoryExists(absolutePath);
    const subjectId = basename(subjectPath);
    return {
        subjectPath,
        subjectId,
        paths: {
            absolutePath,
            eventsPath: join(absolutePath, "events.jsonl"),
            memoryPath: join(absolutePath, "memory.jsonl"),
            ragStatePath: join(project.root, ".nbook", "subject-rag-dirty.json"),
        },
    };
}

function normalizeSubjectPath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "simulation" || parts[1] !== "subjects" || !parts[2]) {
        throwBadRequest("subjectPath 必须形如 simulation/subjects/<subject-id>");
    }
    if (parts.some((part) => part === "." || part === "..")) {
        throwBadRequest("subjectPath 不能包含 . 或 ..");
    }
    return parts.join("/");
}

function assertSubjectDirectoryExists(absolutePath: string): void {
    try {
        if (!statSync(absolutePath).isDirectory()) {
            throwNotFound("subject 不存在");
        }
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            throwNotFound("subject 不存在");
        }
        throw error;
    }
}

async function listSubjectPaths(projectRoot: string): Promise<string[]> {
    const subjectsRoot = join(projectRoot, "simulation", "subjects");
    const entries = await readdir(subjectsRoot, {withFileTypes: true}).catch((error) => {
        if (isNodeError(error, "ENOENT")) {
            return [];
        }
        throw error;
    });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `simulation/subjects/${entry.name}`)
        .sort((left, right) => left.localeCompare(right));
}

async function readSubjectSummary(project: ReturnType<typeof resolveProject>, subjectPath: string): Promise<ProjectRagSubjectSummaryDto> {
    const subject = resolveSubject(project, subjectPath);
    const [eventsResult, memoriesResult, sourceStatuses, subjectFileExists, mindFileExists, stateFileExists] = await Promise.all([
        readEvents(subject.paths.eventsPath),
        readMemories(subject.paths.memoryPath),
        readSourceStatuses(project.root, subject.paths),
        fileExists(join(subject.paths.absolutePath, "subject.md")),
        fileExists(join(subject.paths.absolutePath, "mind.md")),
        fileExists(join(subject.paths.absolutePath, "state.md")),
    ]);
    return {
        subjectPath: subject.subjectPath,
        subjectId: subject.subjectId,
        eventCount: eventsResult.events.length,
        memoryCount: memoriesResult.memories.length,
        subjectFileExists,
        mindFileExists,
        stateFileExists,
        sourceStatuses,
        errors: [...eventsResult.errors, ...memoriesResult.errors],
    };
}

async function readEvents(filePath: string): Promise<{events: SubjectEvent[]; errors: SourceError[]}> {
    const text = await readTextIfExists(filePath);
    try {
        return {
            events: parseSubjectEventsJsonl(text, filePath),
            errors: [],
        };
    } catch (error) {
        return {
            events: [],
            errors: [{source: "events", message: errorMessage(error)}],
        };
    }
}

async function readMemories(filePath: string): Promise<{memories: SubjectMemory[]; errors: SourceError[]}> {
    const text = await readTextIfExists(filePath);
    try {
        return {
            memories: parseSubjectMemoriesJsonl(text, filePath),
            errors: [],
        };
    } catch (error) {
        return {
            memories: [],
            errors: [{source: "memory", message: errorMessage(error)}],
        };
    }
}

function parseEventsForWrite(filePath: string): SubjectEvent[] {
    try {
        return parseSubjectEventsJsonl(readTextSync(filePath), filePath);
    } catch (error) {
        throwConflict(`events.jsonl 无效，请先修复源文件：${errorMessage(error)}`);
    }
}

function parseMemoriesForWrite(filePath: string): SubjectMemory[] {
    try {
        return parseSubjectMemoriesJsonl(readTextSync(filePath), filePath);
    } catch (error) {
        throwConflict(`memory.jsonl 无效，请先修复源文件：${errorMessage(error)}`);
    }
}

function ensureSubjectSourcesReadable(subject: SubjectPaths, sources: SubjectRagSourceType[]): void {
    for (const source of sources) {
        if (source === "events") {
            parseEventsForWrite(subject.eventsPath);
        } else {
            parseMemoriesForWrite(subject.memoryPath);
        }
    }
}

async function writeEventsAndMarkDirty(subject: SubjectPaths, events: SubjectEvent[]): Promise<void> {
    const text = serializeSubjectEventsJsonl(events);
    const nextText = text ? `${text}\n` : "";
    await writeFile(subject.eventsPath, nextText, "utf-8");
    await markSubjectRagDirty(subject, "events", nextText);
}

async function writeMemoriesAndMarkDirty(subject: SubjectPaths, memories: SubjectMemory[]): Promise<void> {
    const text = serializeSubjectMemoriesJsonl(memories);
    const nextText = text ? `${text}\n` : "";
    await writeFile(subject.memoryPath, nextText, "utf-8");
    await markSubjectRagDirty(subject, "memory", nextText);
}

async function readSourceStatuses(projectRoot: string, subject: SubjectPaths): Promise<ProjectRagSourceStatusDto[]> {
    const dbPath = join(projectRoot, ".nbook", "subject-rag.sqlite");
    const rows = await readRagSourceRows(dbPath, subject.absolutePath);
    const dirtyState = await readDirtyState(subject.ragStatePath);
    return RAG_SOURCES.map((source) => {
        const row = rows.find((item) => item.sourceType === source);
        const dirty = dirtyState[subject.absolutePath]?.[source];
        const sourcePath = source === "events" ? subject.eventsPath : subject.memoryPath;
        const sourceHash = subjectMemorySourceHash(readTextSync(sourcePath));
        const dirtyHashMatches = isDirtyRecord(dirty) && (typeof dirty.sourceHash !== "string" || dirty.sourceHash === sourceHash);
        const sourceChanged = Boolean(row && row.sourceHash !== sourceHash);
        const status = resolveIndexStatus(row, dirtyHashMatches || sourceChanged);
        return {
            source,
            status,
            recordCount: row?.recordCount ?? 0,
            indexedAt: row?.indexedAt ?? null,
            lastError: row?.lastError ?? null,
        };
    });
}

async function readRagSourceRows(dbPath: string, subjectPath: string): Promise<Array<{
    sourceType: SubjectRagSourceType;
    sourceHash: string;
    recordCount: number;
    dirty: number;
    indexedAt: string | null;
    lastError: string | null;
}>> {
    try {
        await stat(dbPath);
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return [];
        }
        throw error;
    }
    const db = await openReadonlySqliteDatabase(dbPath);
    try {
        return db.query(`
            SELECT
                source_type AS sourceType,
                source_hash AS sourceHash,
                record_count AS recordCount,
                dirty,
                indexed_at AS indexedAt,
                last_error AS lastError
            FROM subject_rag_sources
            WHERE subject_path = ?
        `).all(subjectPath) as Array<{
            sourceType: SubjectRagSourceType;
            sourceHash: string;
            recordCount: number;
            dirty: number;
            indexedAt: string | null;
            lastError: string | null;
        }>;
    } catch {
        return [];
    } finally {
        db.close();
    }
}

async function openReadonlySqliteDatabase(dbPath: string): Promise<ReadonlySqliteDatabase> {
    if ("Bun" in globalThis) {
        const sqliteSpecifier = "bun:sqlite";
        const sqlite = await import(sqliteSpecifier) as BunSqliteModule;
        return new sqlite.Database(dbPath, {readonly: true});
    }
    const sqliteSpecifier = "node:sqlite";
    const sqlite = await import(sqliteSpecifier) as unknown as NodeSqliteModule;
    const db = new sqlite.DatabaseSync(dbPath, {readOnly: true});
    return {
        query(sql) {
            const statement = db.prepare(sql);
            return {
                all(...params) {
                    return statement.all(...params);
                },
            };
        },
        close() {
            db.close();
        },
    };
}

function resolveIndexStatus(row: Awaited<ReturnType<typeof readRagSourceRows>>[number] | undefined, dirty: boolean): ProjectRagIndexStatusDto {
    if (row?.lastError) {
        return "error";
    }
    if (dirty || row?.dirty === 1) {
        return "dirty";
    }
    if (row?.indexedAt) {
        return "synced";
    }
    if (row) {
        return "not_indexed";
    }
    return "unknown";
}

async function readDirtyState(filePath: string): Promise<Record<string, Record<string, unknown>>> {
    const text = await readTextIfExists(filePath);
    if (!text.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, Record<string, unknown>>
            : {};
    } catch {
        return {};
    }
}

function isDirtyRecord(value: unknown): value is {dirty?: unknown; sourceHash?: unknown} {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as {dirty?: unknown}).dirty === true);
}

function readTextSync(filePath: string): string {
    try {
        return readFileSync(filePath, "utf-8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return "";
        }
        throw error;
    }
}

async function readTextIfExists(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return "";
        }
        throw error;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile();
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

function requireIndex(value: number | undefined, label: string): number {
    if (value === undefined) {
        throwBadRequest(`${label} 不能为空`);
    }
    return value;
}

function assertArrayIndex(values: unknown[], index: number, label: string): void {
    if (index < 0 || index >= values.length) {
        throwConflict(`${label} index 不存在，请刷新后重试`);
    }
}

function throwBadRequest(message: string): never {
    throw createError({statusCode: 400, message});
}

function throwConflict(message: string): never {
    throw createError({statusCode: 409, message});
}

function throwNotFound(message: string): never {
    throw createError({statusCode: 404, message});
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
    return Boolean(typeof error === "object" && error !== null && "code" in error && error.code === code);
}
