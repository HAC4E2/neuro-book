import {afterEach, describe, expect, test} from "bun:test";
import {appendFile, mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {claudeTitleFromTail, createSessionTitles} from "../src/server/session-titles.js";
import {cleanupFixtures, createFixture} from "./git-fixture.js";

/** 会话页的会话标题（t15 阶段 4 第 3 批，决定点 19）：从本机 Agent 的会话文件里读，只读、带缓存。 */
afterEach(async () => {
    await cleanupFixtures();
});

const CLAUDE_ID = "c38df555-3a36-49c9-bf4f-4027b5da6d32";
const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;

describe("Claude Code 的标题", () => {
    test("取末尾一段里各类标题的最后一条：custom-title 先于 agent-name，再先于 ai-title；截断的半行跳过；控制字符去掉", () => {
        const tail = `"type":"user","message":"半行\n${line({type: "ai-title", aiTitle: "旧的自动标题"})}${line({type: "user", message: "x"})}${line({type: "ai-title", aiTitle: "新的\u001b[31m自动标题"})}`;
        expect(claudeTitleFromTail(tail)).toEqual({text: "新的 [31m自动标题", source: "claude-ai-title"});
        expect(claudeTitleFromTail(`${tail}${line({type: "agent-name", agentName: "k1-kernel"})}`)).toEqual({text: "k1-kernel", source: "claude-agent-name"});
        expect(claudeTitleFromTail(`${line({type: "custom-title", customTitle: "我起的名"})}${tail}${line({type: "agent-name", agentName: "k1-kernel"})}`)).toEqual({text: "我起的名", source: "claude-custom"});
        expect(claudeTitleFromTail(line({type: "user", message: "没有标题"}))).toBeNull();
    });
});

describe("按 Agent 找会话文件", () => {
    test("Claude 在任一项目目录里按会话 id 找到文件；Codex 按 session_index 的最后一条；omp 读文件第一行；文件变了重读，找不到为 null", async () => {
        const fixture = await createFixture("session-titles");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-home-x-repo");
        await mkdir(project, {recursive: true});
        const claudeFile = join(project, `${CLAUDE_ID}.jsonl`);
        await writeFile(claudeFile, `${line({type: "user", message: "开始"})}${line({type: "ai-title", aiTitle: "会话页重做"})}`);
        await mkdir(join(home, ".codex"), {recursive: true});
        await writeFile(join(home, ".codex", "session_index.jsonl"), `${line({id: "codex-1", thread_name: "旧名字"})}${line({id: "codex-1", thread_name: "V9 评测"})}${line({id: "codex-2", thread_name: ""})}`);
        const ompDir = join(home, ".omp", "agent", "sessions", "-repo");
        await mkdir(ompDir, {recursive: true});
        const ompFile = join(ompDir, "2026-10-14T01-00-00-000Z_01a12dd3-661a-706f-93f5-1e6f5ac5d513.jsonl");
        await writeFile(ompFile, `${line({type: "title", v: 1, title: "面板界面打磨", source: "auto"})}${line({type: "session", id: "01a12dd3-661a-706f-93f5-1e6f5ac5d513"})}`);
        const logs: string[] = [];
        const titles = createSessionTitles({HOME: home}, (entry) => void logs.push(entry));

        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做", source: "claude-ai-title"});
        await appendFile(claudeFile, line({type: "ai-title", aiTitle: "会话页重做：两栏"}));
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做：两栏", source: "claude-ai-title"});
        expect(await titles.titleOf("claude", "00000000-0000-4000-8000-000000000000")).toBeNull();
        expect(await titles.titleOf("codex", "codex-1")).toEqual({text: "V9 评测", source: "codex"});
        expect(await titles.titleOf("codex", "codex-2")).toBeNull();
        expect(await titles.titleOf("omp", ompFile)).toEqual({text: "面板界面打磨", source: "omp"});
        expect(await titles.titleOf("omp", "01a12dd3-661a-706f-93f5-1e6f5ac5d513")).toEqual({text: "面板界面打磨", source: "omp"});
        expect(await titles.titleOf("shell", "x")).toBeNull();
        // 不像会话 id 的值不拿去拼路径。
        expect(await titles.titleOf("claude", "../../etc/passwd")).toBeNull();
        expect(logs).toEqual([]);
    });
});
