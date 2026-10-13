import {afterEach, describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, readFile, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {editRecordFile, readEditableFile} from "../src/core/edit-ops.js";
import {PANEL_DEVELOPER} from "../src/core/identity.js";
import {createTask, createWork, previewCreateTask, previewCreateWork, setRecordStatus} from "../src/core/operations.js";
import {readRegistry} from "../src/core/registry.js";
import {locateRepository} from "../src/core/repo.js";
import {sha256} from "../src/core/transaction.js";
import {cleanupFixtures, createFixture, git, taskReadme, workReadme, type Fixture} from "./git-fixture.js";

/**
 * t10 面板写入的核心（L2）：预览、开发者身份、编辑白名单与 README 校验、哈希与未提交改动、暂存的改名、
 * 落位后的核对与客户端断开。服务端接口在 panel-writes.test.ts。
 */

afterEach(cleanupFixtures);

const NOW = () => new Date(2026, 9, 13, 10, 0, 0);
const DEV = {caller: PANEL_DEVELOPER, now: NOW};
const TASK_README = ".agents/works/w00001-seed/tasks/t01-seed/README.md";

async function snapshot(fixture: Fixture): Promise<string> {
    const status = await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--ignored");
    return `${await git(fixture.main, "rev-parse", "HEAD")}\n${status}`;
}

async function hashOf(fixture: Fixture, path: string): Promise<string> {
    return sha256(await readFile(join(fixture.main, path)));
}

async function rejection(promise: Promise<unknown>): Promise<{code: string; details: Record<string, unknown>}> {
    try {
        await promise;
    } catch (error) {
        return error as {code: string; details: Record<string, unknown>};
    }
    throw new Error("预期失败，却成功了");
}

describe("新建的预览", () => {
    test("预览给出号、文件内容与提交信息，不取锁、不写登记表、不改任何文件；字段不合规时逐字段列出", async () => {
        const fixture = await createFixture("preview");
        const context = await locateRepository(fixture.main);
        const before = await snapshot(fixture);
        const work = await previewCreateWork(context, {slug: "panel", title: "面板", goal: "做个面板。\n第二行。", taskSlug: "design"}, DEV);
        expect([work.workId, work.taskId, work.problems, work.message]).toEqual(["w00002-panel", "t01-design", [], "docs(w00002): 面板新建 Work w00002-panel 与 t01-design"]);
        expect(work.paths).toEqual([".agents/works/w00002-panel/README.md", ".agents/works/w00002-panel/tasks/t01-design/README.md"]);
        expect(work.files[".agents/works/w00002-panel/README.md"]).toContain("做个面板。\n第二行。");
        const task = await previewCreateTask(context, {workRef: "w00001", slug: "next", title: "下一步"}, DEV);
        expect([task.workId, task.taskId, task.message]).toEqual(["w00001-seed", "t02-next", "docs(w00001): 面板新建 t02-next"]);
        const bad = await previewCreateWork(context, {slug: "Bad Slug", title: "a\u0000b", goal: "x\u0007", taskSlug: "ok", issueNumber: 0}, DEV);
        expect(bad.problems.map((problem) => [problem.field, problem.code])).toEqual([["slug", "invalid_slug"], ["title", "invalid_title"], ["goal", "invalid_text"], ["issue", "usage"]]);
        expect([bad.workId, bad.paths]).toEqual([null, []]);
        const missing = await previewCreateTask(context, {workRef: "w00009", slug: "x", title: "x"}, DEV);
        expect(missing.problems.map((problem) => [problem.field, problem.code])).toEqual([["workId", "work_not_found"]]);
        expect(await snapshot(fixture)).toBe(before);
        expect(existsSync(join(fixture.main, ".local/agent/registry.json"))).toBe(false);
    });
});

describe("开发者身份与控制字符", () => {
    test("面板新建：提交信息标“面板”，登记表的 by 是开发者，不给 caller_unknown；控制字符被拒绝，换行只在正文里允许", async () => {
        const fixture = await createFixture("developer");
        const context = await locateRepository(fixture.main);
        const created = await createWork(context, {slug: "panel", title: "面板", goal: "第一行\n第二行\t缩进", taskSlug: "design"}, DEV);
        expect(created.warnings.map((warning) => warning.code)).not.toContain("caller_unknown");
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00002): 面板新建 Work w00002-panel 与 t01-design");
        const task = await createTask(context, {workRef: "w00002", slug: "build", title: "实现"}, DEV);
        expect(task.warnings.map((warning) => warning.code)).not.toContain("caller_unknown");
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00002): 面板新建 t02-build");
        const {registry} = await readRegistry(fixture.main);
        const entry = registry.works.find((work) => work.workId === "w00002-panel")!;
        expect([entry.by, entry.tasks.map((t) => t.by?.key)]).toEqual([{key: "developer:local", agent: "developer", sessionId: null, label: "local", parentSessionId: null, nestedSessionId: null}, ["developer:local", "developer:local"]]);
        const head = await git(fixture.main, "rev-parse", "HEAD");
        expect((await rejection(createWork(context, {slug: "x", title: "标题\u0000", goal: "g", taskSlug: "y"}, DEV))).code).toBe("invalid_title");
        expect((await rejection(createWork(context, {slug: "x", title: "两\n行", goal: "g", taskSlug: "y"}, DEV))).code).toBe("invalid_title");
        expect(await rejection(createWork(context, {slug: "x", title: "t", goal: "响铃\u0007", taskSlug: "y"}, DEV))).toMatchObject({code: "invalid_text", details: {field: "goal"}});
        expect(await git(fixture.main, "rev-parse", "HEAD")).toBe(head);
        const status = await setRecordStatus(context, {workRef: "w00002", taskRef: "t02", status: "active"}, DEV);
        expect(status.commit.committed).toBe(true);
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00002): t02-build 状态改为 active（面板）");
    });

    test("客户端在写之前断开（signal 已中止）：放锁、什么都不写，报 request_aborted", async () => {
        const fixture = await createFixture("aborted");
        const context = await locateRepository(fixture.main);
        const before = await snapshot(fixture);
        const controller = new AbortController();
        controller.abort();
        expect((await rejection(createWork(context, {slug: "panel", title: "面板", goal: "g", taskSlug: "design"}, {...DEV, signal: controller.signal}))).code).toBe("request_aborted");
        expect(await snapshot(fixture)).toBe(before);
        expect(existsSync(join(fixture.main, ".local/agent/registry.json.lock"))).toBe(false);
        // 锁已放：紧接着的写入照常。
        expect((await createWork(context, {slug: "panel", title: "面板", goal: "g", taskSlug: "design"}, DEV)).data.workId).toBe("w00002-panel");
    });
});

describe("编辑白名单", () => {
    test("只认段检查合格、路径上没有符号链接、在文档树或记录索引里逐字出现的已有文件；classifyDoc 认得的绕路写法都拒绝", async () => {
        const fixture = await createFixture("edit-whitelist");
        await fixture.write("docs/specs/a.md", "# A\n");
        await fixture.write("docs/secret.txt", "secret\n");
        await fixture.write("random/x.md", "# 不在文档树上\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/notes.md", "# 笔记\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/evidences/e.md", "# 证据\n");
        await fixture.commit("docs");
        await mkdir(join(fixture.main, ".local/agent"), {recursive: true});
        await writeFile(join(fixture.main, ".local/agent/notes.md"), "# 本机\n");
        await symlink("../secret.txt", join(fixture.main, "docs/specs/link.md"));
        await mkdir(join(fixture.main, "docs/linked"), {recursive: true});
        await symlink("../specs", join(fixture.main, "docs/linked/specs"));
        const context = await locateRepository(fixture.main);
        const attempt = async (path: string) => (await rejection(editRecordFile(context, {path, content: "x\n", baseHash: "0"}, DEV)));
        for (const path of ["docs/../.local/agent/notes.md", "docs/../../../etc/x.md", "vitepress/../.git/description.md", "docs/.git/x.md", "docs//specs/a.md", "docs/./specs/a.md", "/etc/passwd.md"]) {
            expect([path, (await attempt(path)).details.reason]).toEqual([path, "unsafe_path"]);
        }
        expect((await attempt("docs/specs/link.md")).details.reason).toBe("symlink");
        expect((await attempt("docs/linked/specs/a.md")).details.reason).toBe("symlink");
        expect((await attempt("docs/secret.txt")).details.reason).toBe("not_markdown");
        expect((await attempt("random/x.md")).details.reason).toBe("not_listed");
        expect((await attempt("docs/specs/nope.md")).details.reason).toBe("missing");
        expect((await attempt(".agents/works/w00001-seed/tasks/t01-seed/evidences/e.md")).details.reason).toBe("not_listed");
        expect((await attempt(".agents/works/w00001/tasks/t01-seed/README.md")).details.reason).toBe("missing");
        // 读接口对白名单之外的路径返回 null（404），不借编辑页读出别的文件。
        expect(await readEditableFile(context, "docs/specs/link.md")).toBeNull();
        expect(await readEditableFile(context, "random/x.md")).toBeNull();
        expect((await readEditableFile(context, "docs/specs/a.md"))?.kind).toBe("repo_doc");
        expect((await readEditableFile(context, ".agents/works/w00001-seed/tasks/t01-seed/notes.md"))?.kind).toBe("record_document");
        expect((await readEditableFile(context, TASK_README))?.kind).toBe("task_readme");
    });

    test("记录在分支上维护的 Task：README 读得到但不能编辑（branch_maintained_record）", async () => {
        const fixture = await createFixture("edit-branch");
        const worktree = await fixture.addWorktree("w2", "feat/w2");
        await fixture.addWork("w00002-branchy", ["t01-x"], worktree);
        await fixture.commit("branch work", worktree);
        await fixture.addWork("w00002-branchy", ["t01-x"]);
        await fixture.commit("old copy on master");
        await fixture.write(".agents/works/w00002-branchy/tasks/t01-x/README.md", taskReadme("t01-x", "status: active\n"), worktree);
        await fixture.commit("branch edit", worktree);
        const context = await locateRepository(fixture.main);
        const path = ".agents/works/w00002-branchy/tasks/t01-x/README.md";
        const file = await readEditableFile(context, path);
        expect([file?.editable, file?.reason?.code]).toEqual([false, "branch_maintained_record"]);
        expect((await rejection(editRecordFile(context, {path, content: "x\n", baseHash: file!.hash}, DEV))).code).toBe("branch_maintained_record");
    });
});

test("Task README 还没提交时，它目录里的文档不能编辑（task_not_committed），读得到并写明原因", async () => {
    const fixture = await createFixture("edit-task-doc-uncommitted");
    await fixture.write(".agents/works/w00001-seed/tasks/t02-manual/README.md", taskReadme("t02-manual"));
    await fixture.write(".agents/works/w00001-seed/tasks/t02-manual/notes.md", "# 笔记\n");
    const context = await locateRepository(fixture.main);
    const path = ".agents/works/w00001-seed/tasks/t02-manual/notes.md";
    const file = await readEditableFile(context, path);
    expect([file?.editable, file?.reason?.code]).toEqual([false, "task_not_committed"]);
    const head = await git(fixture.main, "rev-parse", "HEAD");
    expect((await rejection(editRecordFile(context, {path, content: "# 笔记\n改过。\n", baseHash: file!.hash, includeUncommitted: true}, DEV))).code).toBe("task_not_committed");
    expect(await git(fixture.main, "rev-parse", "HEAD")).toBe(head);
});

describe("编辑", () => {
    test("README：哈希不一致报 hash_mismatch（带 currentHash）；frontmatter 改坏、改状态、改 id、加旧字段都拒绝；合规的编辑改 updated 并只提交这一个文件；内容不变不提交", async () => {
        const fixture = await createFixture("edit-readme");
        await fixture.write(TASK_README, taskReadme("t01-seed", "status: active\nupdated: 2026-01-01\n"));
        await fixture.commit("status");
        const context = await locateRepository(fixture.main);
        const original = await readFile(join(fixture.main, TASK_README), "utf8");
        const baseHash = await hashOf(fixture, TASK_README);
        const head = await git(fixture.main, "rev-parse", "HEAD");
        expect(await rejection(editRecordFile(context, {path: TASK_README, content: original, baseHash: "stale"}, DEV))).toMatchObject({code: "hash_mismatch", details: {currentHash: baseHash}});
        const cases: Array<[string, string]> = [
            [original.replace("---\n", ""), "frontmatter"],
            [original.replace("status: active", "status: done"), "status"],
            [original.replace("taskId: t01-seed", "taskId: t02-other"), "taskId"],
            [original.replace("schema: nbook.task/v2", "schema: nbook.task/v1"), "schema"],
            [original.replace("status: active\n", "status: active\nrole: leader\n"), "role"],
        ];
        for (const [content, field] of cases) {
            const error = await rejection(editRecordFile(context, {path: TASK_README, content, baseHash}, DEV));
            expect([field, error.code, (error.details.problems as Array<{field: string}>).map((problem) => problem.field)]).toEqual([field, "invalid_record_edit", [field]]);
        }
        expect(await git(fixture.main, "rev-parse", "HEAD")).toBe(head);
        const same = await editRecordFile(context, {path: TASK_README, content: original, baseHash}, DEV);
        expect([same.data.changed, same.commit.committed]).toEqual([false, false]);
        const edited = await editRecordFile(context, {path: TASK_README, content: original.replace("正文。", "正文，改过。"), baseHash}, DEV);
        expect([edited.data.changed, edited.commit.committed]).toEqual([true, true]);
        expect(edited.data.text).toContain("updated: 2026-10-13\n");
        expect(edited.data.text).toContain("正文，改过。");
        expect(edited.data.nextHash).toBe(await hashOf(fixture, TASK_README));
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00001): 面板编辑 t01 README");
        expect(await git(fixture.main, "show", "--name-only", "--format=", "HEAD")).toBe(TASK_README);
        expect(await git(fixture.main, "diff", "HEAD~1", "HEAD", "--", TASK_README)).toContain("-updated: 2026-01-01\n+updated: 2026-10-13");
    });

    test("主工作区的文档：未提交改动默认拒绝（已暂存与工作区分两段、带 currentHash），确认后连同改动一起提交；文件提交名写路径", async () => {
        const fixture = await createFixture("edit-doc");
        await fixture.write("docs/specs/a.md", "# A\n\n第一行\n");
        await fixture.commit("doc");
        const context = await locateRepository(fixture.main);
        await fixture.write("docs/specs/a.md", "# A\n\n第一行\n暂存的一行\n");
        await git(fixture.main, "add", "docs/specs/a.md");
        await fixture.write("docs/specs/a.md", "# A\n\n第一行\n暂存的一行\n工作区的一行\n");
        const current = await hashOf(fixture, "docs/specs/a.md");
        const file = await readEditableFile(context, "docs/specs/a.md");
        expect([file?.editable, file?.uncommitted?.status]).toEqual([true, ["MM"]]);
        const refused = await rejection(editRecordFile(context, {path: "docs/specs/a.md", content: `${file!.text}我的一行\n`, baseHash: current}, DEV));
        expect(refused.code).toBe("uncommitted_changes");
        expect(refused.details).toMatchObject({currentHash: current, untracked: false, status: ["MM"]});
        expect(refused.details.staged).toContain("+暂存的一行");
        expect(refused.details.unstaged).toContain("+工作区的一行");
        expect(refused.details.unstaged).not.toContain("+暂存的一行");
        const saved = await editRecordFile(context, {path: "docs/specs/a.md", content: `${file!.text}我的一行\n`, baseHash: current, includeUncommitted: true}, DEV);
        expect(saved.commit.committed).toBe(true);
        expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs: 面板编辑 docs/specs/a.md");
        expect(await git(fixture.main, "show", "HEAD:docs/specs/a.md")).toBe("# A\n\n第一行\n暂存的一行\n工作区的一行\n我的一行");
        expect(await git(fixture.main, "status", "--porcelain")).toBe("");
    });

    test("目标是暂存区里一次改名的一端：编辑与状态切换都拒绝（staged_rename），什么都不写", async () => {
        const fixture = await createFixture("edit-rename");
        await fixture.write("docs/specs/old.md", "# Old\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/old.md", "# 旧名\n");
        await fixture.commit("docs");
        await git(fixture.main, "mv", "docs/specs/old.md", "docs/specs/new.md");
        const context = await locateRepository(fixture.main);
        const before = await snapshot(fixture);
        const file = await readEditableFile(context, "docs/specs/new.md");
        expect([file?.stagedRename, file?.editable]).toEqual([true, false]);
        expect(await rejection(editRecordFile(context, {path: "docs/specs/new.md", content: "# New\n", baseHash: file!.hash, includeUncommitted: true}, DEV))).toMatchObject({code: "staged_rename", details: {from: "docs/specs/old.md", to: "docs/specs/new.md"}});
        expect(await snapshot(fixture)).toBe(before);
        await git(fixture.main, "reset", "--quiet");
        await git(fixture.main, "checkout", "--", ".");
        await git(fixture.main, "clean", "-fdq", "docs");
        await git(fixture.main, "mv", TASK_README, ".agents/works/w00001-seed/tasks/t01-seed/README-old.md");
        await git(fixture.main, "mv", ".agents/works/w00001-seed/tasks/t01-seed/old.md", TASK_README);
        expect((await rejection(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "active", includeUncommitted: true}, DEV))).code).toBe("staged_rename");
    });

    test("状态切换先比哈希、再查未提交改动：两条都撞上时报 hash_mismatch", async () => {
        const fixture = await createFixture("status-order");
        const context = await locateRepository(fixture.main);
        await fixture.write(TASK_README, taskReadme("t01-seed", "status: planned\n"));
        const current = await hashOf(fixture, TASK_README);
        expect((await rejection(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "active", expectedHash: "stale"}, DEV))).code).toBe("hash_mismatch");
        expect(await rejection(setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "active", expectedHash: current}, DEV))).toMatchObject({code: "uncommitted_changes", details: {currentHash: current, staged: null}});
        const done = await setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "active", expectedHash: current, includeUncommitted: true}, DEV);
        expect(done.commit.committed).toBe(true);
    });
});

describe("落位之后的核对", () => {
    // 经命令行跑：PATH 里的 git 垫片在事务的某一步改写目标文件，只影响这个子进程。
    async function shimmed(fixture: Fixture, when: string): Promise<Record<string, string>> {
        const shim = join(fixture.root, `shim-${when.replaceAll(" ", "-")}`);
        await mkdir(shim, {recursive: true});
        const target = join(fixture.main, TASK_README);
        await writeFile(join(shim, "git"), `#!/bin/sh\ncase " $* " in *" ${when} "*) printf '别的进程写的\\n' >> "${target}";; esac\nexec /usr/bin/git "$@"\n`, {mode: 0o755});
        return {PATH: `${shim}:${process.env.PATH ?? ""}`};
    }

    test("落位之后、git add 之前文件又被改了：不提交，报 changed_after_write（带 writtenPaths），你的改动留在工作区", async () => {
        const fixture = await createFixture("after-write");
        const head = await git(fixture.main, "rev-parse", "HEAD");
        const result = await fixture.cli(["task", "status", "w00001", "t01", "active", "--as", "bob", "--json"], fixture.main, await shimmed(fixture, "--git-path index.lock"));
        expect([result.exitCode, result.json?.errors[0]?.code]).toEqual([3, "changed_after_write"]);
        expect(result.json?.errors[0]?.details).toMatchObject({changed: [TASK_README], committed: false, writtenPaths: [TASK_README]});
        expect(await git(fixture.main, "rev-parse", "HEAD")).toBe(head);
        const text = await readFile(join(fixture.main, TASK_README), "utf8");
        expect([text.includes("status: active"), text.includes("别的进程写的")]).toEqual([true, true]);
    });

    test("核对之后、git add 之前混进来的改动：照常提交，给 commit_included_foreign_changes", async () => {
        const fixture = await createFixture("foreign");
        const result = await fixture.cli(["task", "status", "w00001", "t01", "active", "--as", "bob", "--json"], fixture.main, await shimmed(fixture, "add --"));
        expect(result.exitCode).toBe(0);
        expect(result.json?.warnings.find((warning) => warning.code === "commit_included_foreign_changes")?.details).toMatchObject({paths: [TASK_README]});
        expect(await git(fixture.main, "show", `HEAD:${TASK_README}`)).toContain("别的进程写的");
    });
});

test("workReadme 夹具：Work README 的编辑同样校验 issueId", async () => {
    const fixture = await createFixture("edit-work");
    const context = await locateRepository(fixture.main);
    const path = ".agents/works/w00001-seed/README.md";
    const text = await readFile(join(fixture.main, path), "utf8");
    expect(text).toBe(workReadme("w00001-seed"));
    const baseHash = await hashOf(fixture, path);
    expect((await rejection(editRecordFile(context, {path, content: text.replace("issueId: null", "issueId: i7"), baseHash}, DEV))).code).toBe("invalid_record_edit");
    const saved = await editRecordFile(context, {path, content: text.replace("的目标。", "的目标，写清楚。"), baseHash}, DEV);
    expect(saved.commit.committed).toBe(true);
    expect(await git(fixture.main, "log", "-1", "--format=%s")).toBe("docs(w00001): 面板编辑 Work README");
});
