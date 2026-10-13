import {lstat, readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {systemErrorCode} from "./errors.js";
import {parseFrontmatter, readTitle} from "./frontmatter.js";
import {gitOutput, splitNul} from "./git.js";
import {guardedFile} from "./paths.js";
import {MASTER_REF} from "./repo.js";
import type {CommitEntry} from "./task-detail.js";

/**
 * 文档视图的读取：按类型分组的文档树、与 master 的差异、单份文档。只读。
 * “master”在这里指主工作区的工作区（含未提交的文档），不是 `master` 引用：面板给开发者看的是他眼前的那一份。
 * Work 与 Task 目录里的 Markdown 不在树里，由记录（`status` 的 `documents`）索引。
 */

export type DocGroup = "entry" | "spec" | "adr" | "proposal" | "module" | "standard" | "testing" | "intent" | "repo" | "package" | "skill" | "site";
export type DocEntry = {path: string; group: DocGroup; section: string};
export type DocChangeKind = "added" | "modified" | "deleted" | "master_only";
export type DocChange = {path: string; change: DocChangeKind};
export type DocTree = {docs: DocEntry[]; changes: DocChange[]};
export type DocFile = {path: string; text: string; title: string | null; frontmatter: Record<string, unknown> | null; body: string; recent: CommitEntry[]};

/** 列文档时给 `git ls-files` 的目录（字面路径）；仓库根的 Markdown 另按根目录的文件名补上。 */
const DOC_SCOPES = ["docs", "packages", ".agents/skills", "vitepress", "scripts", "desktop"];

/** 一个仓库根相对路径属于哪一组文档；不是文档时为 null。`section` 是组内的小节（Spec 的目录、包名、Skill 名）。 */
export function classifyDoc(path: string): {group: DocGroup; section: string} | null {
    if (!path.endsWith(".md")) return null;
    const segments = path.split("/");
    if (segments.some((segment) => segment === "node_modules" || segment === "evidences" || segment === "experiments" || segment === "dist")) return null;
    const name = segments.at(-1)!;
    if (segments.length === 1) return {group: "entry", section: ""};
    if (name === "AGENTS.md" || name === "CLAUDE.md") return {group: "entry", section: segments.slice(0, -1).join("/")};
    if (segments.includes("adr") && segments[segments.indexOf("adr") - 1] === "docs") return {group: "adr", section: segments.slice(0, segments.indexOf("adr") - 1).join("/")};
    if (segments[0] === "docs") {
        const kind = segments[1];
        const groups: Record<string, DocGroup> = {specs: "spec", proposals: "proposal", modules: "module", standards: "standard", testing: "testing", intent: "intent"};
        const group = kind ? groups[kind] : undefined;
        if (group) return {group, section: segments.slice(1, -1).join("/")};
        return {group: "repo", section: "docs"};
    }
    if (segments[0] === "packages" && segments.length >= 3) {
        if (segments[2] === "docs" || (segments.length === 3 && (name === "CONTEXT.md" || name === "README.md"))) return {group: "package", section: segments[1]!};
        return null;
    }
    if (segments[0] === ".agents" && segments[1] === "skills" && segments.length >= 4) return {group: "skill", section: segments[2]!};
    if (segments[0] === "vitepress") return {group: "site", section: segments.slice(1, -1).join("/")};
    return null;
}

async function rootMarkdown(root: string): Promise<string[]> {
    try {
        return (await readdir(root, {withFileTypes: true})).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return [];
        throw error;
    }
}

/**
 * 一个 checkout 里的文档（已跟踪的与未被忽略的未跟踪文件），按路径排序。磁盘上不是普通文件的不列：
 * 符号链接（Git 照样列出它，读它会读到链接指向的文件，见 `readDocFile`）与工作区里已删掉、还没暂存删除的文件。
 */
export async function listDocPaths(root: string): Promise<string[]> {
    const scopes = [...DOC_SCOPES, ...await rootMarkdown(root)];
    const listed = splitNul(await gitOutput(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...scopes], {readOnly: true}));
    const docs = [...new Set(listed)].filter((path) => classifyDoc(path) !== null).sort();
    const regular = await Promise.all(docs.map(async (path) => {
        try {
            return (await lstat(resolve(root, path))).isFile();
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return false;
            throw error;
        }
    }));
    return docs.filter((_path, index) => regular[index]);
}

/** 分支自分出以来改过的文档（`master...HEAD` 的三点 diff），值是 `A`、`M`、`D`。面板按 checkout 的 HEAD 缓存它。 */
export async function branchChangedDocs(root: string): Promise<Map<string, string>> {
    const output = splitNul(await gitOutput(root, ["diff", "--name-status", "-z", "--no-renames", `${MASTER_REF}...HEAD`, "--", ...DOC_SCOPES, ...await rootMarkdown(root)], {readOnly: true}));
    const changes = new Map<string, string>();
    for (let index = 0; index + 1 < output.length; index += 2) {
        const path = output[index + 1]!;
        if (classifyDoc(path)) changes.set(path, output[index]!.slice(0, 1));
    }
    return changes;
}

/** 工作区里没提交的文档改动：`??` 与 `A` 记成新增，`D` 记成删去，其余记成改动。 */
async function uncommittedDocs(root: string): Promise<Map<string, string>> {
    const entries = splitNul(await gitOutput(root, ["status", "--porcelain", "-z", "-uall", "--no-renames", "--", ...DOC_SCOPES, ...await rootMarkdown(root)], {readOnly: true}));
    const changes = new Map<string, string>();
    for (const entry of entries) {
        const path = entry.slice(3);
        if (!classifyDoc(path)) continue;
        const code = entry.slice(0, 2);
        changes.set(path, code === "??" || code.includes("A") ? "A" : code.includes("D") ? "D" : "M");
    }
    return changes;
}

/**
 * 一个 checkout 的文档树，`mainDocs` 是主工作区的文档。不是主工作区时附与 master 的差异，分两类：
 * 分支改的（三点 diff 加工作区里没提交的）；master 有、这里没有、也不是分支删的（分支分出之后 master 新增的）。
 */
export async function readDocTree(root: string, isMain: boolean, mainDocs: readonly string[], branchChanges?: ReadonlyMap<string, string>): Promise<DocTree> {
    const paths = isMain ? [...mainDocs] : await listDocPaths(root);
    const docs = paths.map((path) => ({path, ...classifyDoc(path)!}));
    if (isMain) return {docs, changes: []};
    const committed = branchChanges ?? await branchChangedDocs(root);
    const uncommitted = await uncommittedDocs(root);
    const here = new Set(paths);
    const master = new Set(mainDocs);
    const changes: DocChange[] = [];
    for (const path of paths) {
        const code = uncommitted.get(path) ?? committed.get(path);
        if (code === "A") changes.push({path, change: master.has(path) ? "modified" : "added"});
        else if (code === "M" || code === "D") changes.push({path, change: "modified"});
    }
    for (const path of mainDocs) {
        if (here.has(path)) continue;
        const deleted = (uncommitted.get(path) ?? committed.get(path)) === "D";
        changes.push({path, change: deleted ? "deleted" : "master_only"});
    }
    changes.sort((left, right) => left.path.localeCompare(right.path));
    return {docs, changes};
}

/**
 * 读一份文档：原文、frontmatter（读不出时为 null）、标题与这个 checkout 上最近 5 次碰过它的提交。
 * 路径由调用方按文档树核对过，这里再经路径守卫（`guardedFile`）读：白名单只核对路径，挡不住指向 `.env` 或仓库外的符号链接。
 */
export async function readDocFile(root: string, path: string): Promise<DocFile | null> {
    const real = await guardedFile(root, path);
    if (real === null) return null;
    let text: string;
    try {
        text = await readFile(real, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "EISDIR") return null;
        throw error;
    }
    const parsed = parseFrontmatter(text);
    const log = await gitOutput(root, ["log", "-n5", "--format=%x1e%H%x1f%cI%x1f%an%x1f%s", "HEAD", "--", path], {readOnly: true});
    const recent = log.split("\x1e").map((block) => block.trim()).filter((block) => block !== "").map((block) => {
        const [sha = "", date = "", author = "", subject = ""] = block.split("\x1f");
        return {sha, date, author, subject};
    });
    return {path, text, title: readTitle(parsed.body), frontmatter: parsed.ok ? parsed.data : null, body: parsed.body, recent};
}
