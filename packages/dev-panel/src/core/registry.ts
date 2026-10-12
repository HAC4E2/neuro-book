import {randomBytes} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {NbdevError, systemErrorCode} from "./errors.js";

export const REGISTRY_SCHEMA = "nbdev.registry/v1";
export const AGENT_LOCAL_ROOT = ".local/agent";
export const REGISTRY_FILE = `${AGENT_LOCAL_ROOT}/registry.json`;

export const REGISTRY_STATUSES = ["claimed", "imported", "abandoned"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

/** 领号的会话（t07 起写；t06 写出的为 null）。 */
export type RegistryBy = {key: string; agent: string; sessionId: string | null; label: string | null; parentSessionId: string | null};
export type RegistryTaskEntry = {taskId: string; status: RegistryStatus; at: string; by: RegistryBy | null; home: string | null};
export type RegistryWorkEntry = {workId: string; status: RegistryStatus; at: string; by: RegistryBy | null; home: string | null; tasks: RegistryTaskEntry[]};
/**
 * 登记表只记领号的事实，三种状态的号都不再发；标题、进度、状态一律读 README。
 * 它不是可重新生成的原始输出：扫描只能重建 `imported`，`claimed`、`abandoned`、`home`、`by` 会丢。
 */
export type Registry = {schema: typeof REGISTRY_SCHEMA; works: RegistryWorkEntry[]};

export function emptyRegistry(): Registry {
    return {schema: REGISTRY_SCHEMA, works: []};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RegistryStatus {
    return typeof value === "string" && (REGISTRY_STATUSES as readonly string[]).includes(value);
}

function parseBy(value: unknown, label: string): RegistryBy | null {
    if (value === null || value === undefined) return null;
    if (!isRecord(value) || typeof value.key !== "string" || typeof value.agent !== "string") throw new NbdevError("invalid_record", `登记表条目的 by 无效：${label}`);
    const optional = (field: unknown) => typeof field === "string" ? field : null;
    return {key: value.key, agent: value.agent, sessionId: optional(value.sessionId), label: optional(value.label), parentSessionId: optional(value.parentSessionId)};
}

function parseEntryCommon(value: Record<string, unknown>, label: string): {status: RegistryStatus; at: string; by: RegistryBy | null; home: string | null} {
    if (!isStatus(value.status)) throw new NbdevError("invalid_record", `登记表条目的 status 无效：${label}`);
    if (typeof value.at !== "string") throw new NbdevError("invalid_record", `登记表条目缺少 at：${label}`);
    if (value.home !== null && value.home !== undefined && typeof value.home !== "string") throw new NbdevError("invalid_record", `登记表条目的 home 无效：${label}`);
    return {status: value.status, at: value.at, by: parseBy(value.by, label), home: typeof value.home === "string" ? value.home : null};
}

/** 校验登记表 JSON；主版本不认识报 `schema_unsupported`，结构不对报 `invalid_record`。 */
export function parseRegistry(text: string, path: string): Registry {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new NbdevError("invalid_record", `登记表不是合法 JSON：${path}`, {cause: error, details: {path}});
    }
    if (!isRecord(value)) throw new NbdevError("invalid_record", `登记表顶层必须是对象：${path}`, {details: {path}});
    if (value.schema !== REGISTRY_SCHEMA) {
        throw new NbdevError("schema_unsupported", `不认识的登记表 schema：${String(value.schema)}`, {details: {path, schema: value.schema}});
    }
    if (!Array.isArray(value.works)) throw new NbdevError("invalid_record", `登记表缺少 works：${path}`, {details: {path}});
    const works: RegistryWorkEntry[] = [];
    for (const work of value.works) {
        if (!isRecord(work) || typeof work.workId !== "string" || !Array.isArray(work.tasks)) {
            throw new NbdevError("invalid_record", `登记表的 Work 条目无效：${path}`, {details: {path}});
        }
        const tasks: RegistryTaskEntry[] = [];
        for (const task of work.tasks) {
            if (!isRecord(task) || typeof task.taskId !== "string") throw new NbdevError("invalid_record", `登记表的 Task 条目无效：${work.workId}`, {details: {path}});
            tasks.push({taskId: task.taskId, ...parseEntryCommon(task, `${work.workId}/${task.taskId}`)});
        }
        works.push({workId: work.workId, ...parseEntryCommon(work, work.workId), tasks});
    }
    return {schema: REGISTRY_SCHEMA, works};
}

/** 读主工作区的登记表；文件不存在时返回空表，`exists: false`。 */
export async function readRegistry(mainRoot: string): Promise<{registry: Registry; exists: boolean}> {
    const path = resolve(mainRoot, REGISTRY_FILE);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return {registry: emptyRegistry(), exists: false};
        throw error;
    }
    return {registry: parseRegistry(text, path), exists: true};
}

export function findWork(registry: Registry, workId: string): RegistryWorkEntry | undefined {
    return registry.works.find((work) => work.workId === workId);
}

export function findTask(registry: Registry, workId: string, taskId: string): RegistryTaskEntry | undefined {
    return findWork(registry, workId)?.tasks.find((task) => task.taskId === taskId);
}

export function isClaimedTask(registry: Registry, workId: string, taskId: string): boolean {
    return findTask(registry, workId, taskId)?.status === "claimed";
}

function ensureWork(registry: Registry, workId: string, status: RegistryStatus, at: string): {entry: RegistryWorkEntry; added: boolean} {
    const existing = findWork(registry, workId);
    if (existing) return {entry: existing, added: false};
    const entry: RegistryWorkEntry = {workId, status, at, by: null, home: null, tasks: []};
    registry.works.push(entry);
    return {entry, added: true};
}

/** 把扫描到、登记表里还没有的 id 补登为 `imported`；返回补登的 id（Task 写成 `<workId>/<taskId>`）。 */
export function importScanned(registry: Registry, scanned: ReadonlyMap<string, readonly string[]>, at: string): string[] {
    const added: string[] = [];
    for (const [workId, taskIds] of scanned) {
        const work = ensureWork(registry, workId, "imported", at);
        if (work.added) added.push(workId);
        for (const taskId of taskIds) {
            if (work.entry.tasks.some((task) => task.taskId === taskId)) continue;
            work.entry.tasks.push({taskId, status: "imported", at, by: null, home: null});
            added.push(`${workId}/${taskId}`);
        }
    }
    return added;
}

export function claimWork(registry: Registry, workId: string, at: string, by: RegistryBy | null = null): void {
    if (findWork(registry, workId)) throw new NbdevError("internal", `登记表里已有 ${workId}，不能再领`);
    ensureWork(registry, workId, "claimed", at).entry.by = by;
}

export function claimTask(registry: Registry, workId: string, taskId: string, at: string, by: RegistryBy | null = null): void {
    const work = ensureWork(registry, workId, "imported", at).entry;
    if (work.tasks.some((task) => task.taskId === taskId)) throw new NbdevError("internal", `登记表里已有 ${workId}/${taskId}，不能再领`);
    work.tasks.push({taskId, status: "claimed", at, by, home: null});
}

function sortRegistry(registry: Registry): Registry {
    const works = [...registry.works].sort((left, right) => left.workId.localeCompare(right.workId, "en"));
    return {
        schema: REGISTRY_SCHEMA,
        works: works.map((work) => ({...work, tasks: [...work.tasks].sort((left, right) => left.taskId.localeCompare(right.taskId, "en"))})),
    };
}

/** 只在写事务的锁内调用：先写同目录临时文件再改名，读者不会读到半个 JSON。 */
export async function writeRegistry(mainRoot: string, registry: Registry): Promise<void> {
    const path = resolve(mainRoot, REGISTRY_FILE);
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
        await mkdir(dirname(path), {recursive: true});
        await writeFile(temporary, `${JSON.stringify(sortRegistry(registry), null, 4)}\n`, {encoding: "utf8", flag: "wx"});
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, {force: true});
        throw new NbdevError("write_failed", `写登记表失败：${path}`, {cause: error, details: {path}});
    }
}
