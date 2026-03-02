import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {AgentSystem} from "nbook/server/agent/agent-system";
import type {RetrievalProfileInput, WriterLorebookEntry} from "nbook/server/agent/types";

type ScriptOptions = {
    keep: boolean;
    keepThreads: boolean;
    leaderOnly: boolean;
    maxEntries: number;
    timeoutMs: number;
    modelKey: string | null;
    workspace: string | null;
};

type RetrievalReport = {
    paths: string[];
    walkthrough: string;
};

type ToolCapture = {
    name: string;
    status: string;
};

const DEFAULT_MAX_ENTRIES = 6;
const DEFAULT_TIMEOUT_MS = 180_000;
const FIXTURE_ROOT = path.join(".agent", "manual-retrieval-e2e");

/**
 * 解析命令行参数。
 */
function parseArgs(argv: string[]): ScriptOptions {
    const options: ScriptOptions = {
        keep: false,
        keepThreads: false,
        leaderOnly: false,
        maxEntries: DEFAULT_MAX_ENTRIES,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        modelKey: null,
        workspace: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--keep") {
            options.keep = true;
            continue;
        }
        if (arg === "--keep-threads") {
            options.keepThreads = true;
            continue;
        }
        if (arg === "--leader-only") {
            options.leaderOnly = true;
            options.keepThreads = true;
            continue;
        }
        if (arg === "--workspace") {
            const workspace = argv[index + 1]?.trim();
            if (!workspace) {
                throw new Error("--workspace 需要非空路径");
            }
            options.workspace = workspace;
            options.keep = true;
            index += 1;
            continue;
        }
        if (arg === "--max-entries") {
            options.maxEntries = readPositiveInteger(argv[index + 1], "--max-entries");
            index += 1;
            continue;
        }
        if (arg === "--timeout-ms") {
            options.timeoutMs = readPositiveInteger(argv[index + 1], "--timeout-ms");
            index += 1;
            continue;
        }
        if (arg === "--model") {
            const modelKey = argv[index + 1]?.trim();
            if (!modelKey) {
                throw new Error("--model 需要非空 model key");
            }
            options.modelKey = modelKey;
            index += 1;
            continue;
        }
        throw new Error(`未知参数: ${arg}`);
    }

    return options;
}

/**
 * 输出带时间戳的进度日志。
 */
function logProgress(message: string): void {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

/**
 * 输出一段对话消息头。
 */
function printMessageHeader(role: string): void {
    console.log(`\n\n========== ${role} Message ==========\n`);
}

/**
 * 解析 workspace 参数为绝对路径。
 */
function resolveWorkspacePath(workspace: string | null, stamp: string): string {
    if (!workspace) {
        return path.resolve(FIXTURE_ROOT, stamp);
    }
    return path.resolve(workspace);
}

/**
 * 读取正整数参数。
 */
function readPositiveInteger(raw: string | undefined, name: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} 需要正整数`);
    }
    return value;
}

/**
 * 写入测试用 Markdown 文件。
 */
async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, content, "utf-8");
}

/**
 * 创建真实 retrieval 测试 workspace。
 */
async function createFixture(root: string): Promise<void> {
    await writeFixtureFile(root, "workspace.yaml", [
        "slug: manual-retrieval-e2e",
        "title: 手动 Retrieval E2E",
        "",
    ].join("\n"));

    await writeFixtureFile(root, "lorebook/character/苏雪/index.md", `---
title: 苏雪
type: character
subtype: person
status: active
icon: null
aliases: ["银眸公主"]
tags: ["主角", "王室"]
summary: "王国失踪的银眸公主，正在白塔书库寻找能证明身份的王室纹章。"
refs:
  - relation: located_at
    target: ../../location/白塔书库/
    note: "当前调查地点"
retrieval:
  enabled: true
  trigger: "当章节涉及白塔书库、王室身份、银眸公主或秘密调查时召回。"
inject:
  profiles: []
  always: false
governance:
  source: manual
  review: reviewed
writingTip: "写苏雪时保持克制、警觉，不直接暴露真实身份。"
character:
  logline: "隐藏身份的银眸公主。"
  profile: {}
  story: {}
  meta: {}
ext: {}
---

## 概要

苏雪正在调查白塔书库封锁背后的王室阴谋。
`);

    await writeFixtureFile(root, "lorebook/character/苏雪/state.md", `---
statusNote: "苏雪携带半枚王室纹章，知道白塔书库封锁与旧王室血脉有关。"
updatedAt: "manual-e2e"
knowledge:
  - "苏雪知道自己是失踪的银眸公主，但不希望守卫发现。"
  - "苏雪怀疑[白塔书库](../../location/白塔书库/)中藏有王室档案。"
---

## 当前状态

- 位置：白塔书库外层回廊。
- 持有物：半枚王室纹章、伪造通行令。
`);

    await writeFixtureFile(root, "lorebook/location/白塔书库/index.md", `---
title: 白塔书库
type: location
subtype: building
status: active
icon: null
aliases: ["王都禁书库"]
tags: ["王都", "禁区"]
summary: "王都银穹城的禁书库，保存王室血脉档案，夜间由誓约守卫封锁。"
refs: []
retrieval:
  enabled: true
  trigger: "当场景发生在书库、禁区、档案室或守卫封锁区域时召回。"
inject:
  profiles: []
  always: false
governance:
  source: manual
  review: reviewed
writingTip: "描写白塔书库时突出冷白石材、封蜡档案和压低的脚步声。"
location:
  parent: null
  region: "王都银穹城"
  terrain: null
  climate: null
  atmosphere: "冷、静、压迫。"
  access: "夜间需要王室通行令。"
  landmarks: ["封蜡档案墙", "银梯", "誓约门"]
  risks: ["誓约守卫巡逻", "身份暴露"]
  resources: ["王室血脉档案"]
ext: {}
---

## 概要

白塔书库是本章潜入和身份线索的核心地点。
`);

    await writeFixtureFile(root, "lorebook/location/白塔书库/state.md", `---
statusNote: "书库今夜封锁，外层回廊有两名守卫，内层誓约门尚未开启。"
updatedAt: "manual-e2e"
knowledge:
  - "守卫只知道今夜有禁令，不知道苏雪的真实身份。"
---

## 当前状态

外层回廊仍可潜入，内层需要纹章共鸣。
`);

    await writeFixtureFile(root, "lorebook/rule/誓约守卫/index.md", `---
title: 誓约守卫
type: rule
subtype: local
status: active
icon: null
aliases: []
tags: ["战斗", "潜入", "白塔书库"]
summary: "白塔书库守卫遵循旧王室誓约，只会攻击无法通过纹章共鸣验证的人。"
refs:
  - relation: applies_to
    target: ../location/白塔书库/
    note: null
retrieval:
  enabled: true
  trigger: "当出现潜入、追逐、守卫盘问、战斗或纹章验证时召回。"
inject:
  profiles: []
  always: false
governance:
  source: manual
  review: reviewed
writingTip: "战斗场景不要写成普通士兵围攻，要体现誓约规则和验证机制。"
rule:
  scope: "白塔书库"
  priority: "high"
  trigger: "未经纹章验证者进入内层。"
  effect: "守卫启动誓约攻击。"
  limits: "王室血脉持有者可短暂压制。"
  exceptions: []
  examples: []
  conflicts: []
ext: {}
---

## 概要

誓约守卫是本章潜入转为冲突时的重要规则。
`);

    await writeFixtureFile(root, "lorebook/note/冷白叙事风格/index.md", `---
title: 冷白叙事风格
type: note
subtype: style
status: active
icon: null
aliases: []
tags: ["风格"]
summary: "白塔相关章节使用冷白、克制、压低情绪的叙事风格。"
refs: []
retrieval:
  enabled: false
  trigger: null
inject:
  profiles: ["subagent.writer"]
  always: true
governance:
  source: manual
  review: reviewed
writingTip: "句子短一些，避免热烈比喻，多使用冷光、石面、呼吸和回声。"
ext: {}
---

## 概要

这是直接注入 writer 的风格条目，不应该靠旧 keywords/tip 召回。
`);

    await writeFixtureFile(root, "manuscript/001-第一卷/003-白塔潜入/index.md", `---
title: 白塔潜入
type: chapter
subtype: null
status: draft
icon: null
aliases: []
tags: []
summary: "苏雪潜入白塔书库，寻找王室血脉档案。"
refs: []
retrieval:
  enabled: true
  trigger: null
inject:
  profiles: []
  always: false
governance:
  source: manual
  review: proposed
writingTip: null
ext: {}
---

## 大纲

苏雪趁夜进入白塔书库，在外层回廊避开守卫，尝试用半枚王室纹章打开内层誓约门。
`);
}

/**
 * 订阅 retrieval 运行并提取 report_result。
 */
async function waitForRetrievalReport(agentSystem: AgentSystem, threadId: string, timeoutMs: number): Promise<{
    report: RetrievalReport;
    tools: ToolCapture[];
}> {
    const tools: ToolCapture[] = [];
    const toolNamesByNodeId = new Map<string, string>();
    const toolArgsByNodeId = new Map<string, string>();
    let report: RetrievalReport | null = null;
    let failedError = "";
    let runFinished = false;
    let assistantMessageOpen = false;
    let thinkingMessageOpen = false;

    await Promise.race([
        (async () => {
            for await (const event of agentSystem.subscribeThreadActive(threadId)) {
                if (event.type === "run_state") {
                    console.log(`\n[run_state] ${event.status}${event.error ? ` (${event.error})` : ""}`);
                    if (event.status === "completed" || event.status === "stopped" || event.status === "failed") {
                        runFinished = true;
                    }
                }
                if (event.type === "thinking_delta") {
                    if (!thinkingMessageOpen) {
                        printMessageHeader("assistant thinking");
                        thinkingMessageOpen = true;
                    }
                    process.stdout.write(event.chunkText);
                }
                if (event.type === "assistant_delta") {
                    if (!assistantMessageOpen) {
                        printMessageHeader("assistant");
                        assistantMessageOpen = true;
                    }
                    process.stdout.write(event.chunkText);
                }
                if (event.type === "tool_call_started") {
                    toolNamesByNodeId.set(event.toolNodeId, event.toolName);
                    printMessageHeader("assistant tool_call");
                    console.log(`name: ${event.toolName}`);
                }
                if (event.type === "tool_args_delta") {
                    const previous = toolArgsByNodeId.get(event.toolNodeId) ?? "";
                    const nextArgs = `${previous}${event.argsChunk}`;
                    toolArgsByNodeId.set(event.toolNodeId, nextArgs);
                    process.stdout.write(event.argsChunk);
                }
                if (event.type === "tool_exec_started") {
                    const toolName = toolNamesByNodeId.get(event.toolNodeId) ?? event.toolNodeId;
                    console.log(`\n[tool_exec] ${toolName}`);
                }
                if (event.type === "tool_finished") {
                    tools.push({
                        name: event.toolCall.toolName,
                        status: event.toolCall.status,
                    });
                    printMessageHeader("tool");
                    console.log(`name: ${event.toolCall.toolName}`);
                    console.log(`status: ${event.toolCall.status}`);
                    if (event.toolCall.toolName === "report_result" && event.toolCall.status === "success") {
                        report = parseRetrievalReport(event.toolCall.rawResult);
                        console.log(renderRetrievalToolMessage(report));
                    } else {
                        console.log(renderToolMessagePreview(event.toolCall.outputText));
                    }
                }
                if (event.type === "run_state" && event.status === "failed") {
                    failedError = event.error ?? "retrieval run failed";
                }
                if (report && runFinished) {
                    return;
                }
            }
        })(),
        new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`等待 retrieval 超时: ${String(timeoutMs)}ms`)), timeoutMs);
        }),
    ]);

    if (failedError) {
        throw new Error(failedError);
    }
    if (!report) {
        throw new Error("retrieval run 未产出 report_result");
    }

    return {
        report,
        tools,
    };
}

/**
 * 解析 report_result rawResult。
 */
function parseRetrievalReport(rawResult: unknown): RetrievalReport {
    if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
        throw new Error("report_result rawResult 不是对象");
    }
    const payload = rawResult as {data?: unknown; walkthrough?: unknown};
    if (!Array.isArray(payload.data) || !payload.data.every((item) => typeof item === "string")) {
        throw new Error("report_result rawResult.data 不是 string[]");
    }

    return {
        paths: payload.data,
        walkthrough: typeof payload.walkthrough === "string" ? payload.walkthrough : "",
    };
}

/**
 * 将 report_result 结果渲染为可读 tool message。
 */
function renderRetrievalToolMessage(report: RetrievalReport): string {
    const lines = [
        `walkthrough: ${report.walkthrough}`,
        `retrieved paths: ${String(report.paths.length)}`,
        ...report.paths.map((nodePath, index) => `${String(index + 1)}. ${nodePath}`),
    ];
    return lines.join("\n");
}

/**
 * 截断普通工具消息，避免控制台被长文件内容刷屏。
 */
function renderToolMessagePreview(outputText: string): string {
    const text = outputText.trim();
    if (!text) {
        return "(empty tool message)";
    }
    const limit = 2_000;
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}\n... [tool message truncated, original length ${String(text.length)}]`;
}

/**
 * 渲染人工验证报告。
 */
function renderReport(input: {
    workspaceRoot: string;
    leaderThreadId: string;
    retrievalThreadId: string;
    startedAt: number;
    tools: ToolCapture[];
    report: RetrievalReport;
}): string {
    const lines = [
        "# Manual Retrieval E2E Report",
        "",
        `Workspace: ${input.workspaceRoot}`,
        `Leader thread: ${input.leaderThreadId}`,
        `Retrieval thread: ${input.retrievalThreadId}`,
        `Duration: ${String(Date.now() - input.startedAt)}ms`,
        "",
        "## Tool Calls",
        ...input.tools.map((tool) => `- ${tool.name}: ${tool.status}`),
        "",
        "## Retrieved Entries",
    ];

    input.report.paths
        .forEach((nodePath, index) => {
            lines.push(
                "",
                `${String(index + 1)}. ${nodePath}`,
            );
        });

    const writerEntries = input.report.paths.map((nodePath, index): WriterLorebookEntry => ({
        path: nodePath,
        priority: index + 1,
    }));

    lines.push(
        "",
        "## Walkthrough",
        "",
        input.report.walkthrough,
        "",
        "## writer.lorebookEntries JSON",
        "",
        JSON.stringify(writerEntries, null, 2),
        "",
    );

    return lines.join("\n");
}

/**
 * 程序入口。
 */
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const startedAt = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workspaceRoot = resolveWorkspacePath(options.workspace, stamp);
    const agentSystem = AgentSystem.createDefault();
    let leaderThreadId = "";
    let retrievalThreadId = "";

    try {
        if (options.workspace) {
            await fs.access(workspaceRoot);
            logProgress(`使用已有 workspace: ${workspaceRoot}`);
        } else {
            logProgress(`创建临时 workspace fixture: ${workspaceRoot}`);
            await createFixture(workspaceRoot);
        }

        const leader = await agentSystem.createLeaderThread({
            title: "Manual Retrieval E2E Leader",
            ...(options.modelKey
                ? {
                    modelOverride: {
                        modelKey: options.modelKey,
                        temperature: null,
                        topK: null,
                        stream: true,
                    },
                }
                : {}),
        });
        leaderThreadId = leader.id;
        logProgress(`leader thread ready: ${leaderThreadId}`);

        await agentSystem.syncClientVariables(leaderThreadId, {
            studio: {
                workspace: workspaceRoot,
                currentChapterTitle: "白塔潜入",
                currentChapterLabel: "003 白塔潜入",
                selectionVersion: 1,
            },
            ide: {
                activePanel: "manual-retrieval-e2e",
            },
        });
        logProgress("leader scope synced with workspace");

        if (options.leaderOnly) {
            console.log([
                "",
                "# Manual Retrieval Leader",
                "",
                `Workspace: ${workspaceRoot}`,
                `Leader thread: ${leaderThreadId}`,
                "",
                "这个 leader thread 已保留，可在 UI 或脚本里继续测试。",
                "建议提示词：请先创建 subagent.retrieval，根据当前章节目标召回相关内容节点，再把结果整理成 writer.lorebookEntries JSON。",
                "",
            ].join("\n"));
            return;
        }

        const retrieval = await agentSystem.createSubAgentThread({
            leaderThreadId,
            profileKey: "subagent.retrieval",
            title: "Manual Retrieval E2E",
        });
        retrievalThreadId = retrieval.id;
        logProgress(`retrieval subagent ready: ${retrievalThreadId}`);

        const input: RetrievalProfileInput = {
            targetProfile: "subagent.writer",
            task: "为白塔潜入章节正文写作召回相关内容节点。",
            prompt: "苏雪夜间潜入白塔书库，避开守卫，寻找王室血脉档案，并准备打开内层誓约门。",
            chapterOutline: "1. 苏雪进入白塔书库外层回廊。2. 她用伪造通行令避开第一轮盘问。3. 半枚王室纹章与内层誓约门产生共鸣。4. 守卫即将发现异常。",
            recentText: "夜色像一层薄霜压在白塔外墙上。苏雪把通行令藏进袖口，听见回廊尽头的靴声越来越近。",
            constraints: [
                "第一条搜索命令必须使用 workspace node parse --stdin --ndjson 批量解析内容节点 metadata。",
                "在完成 metadata inventory 前，禁止使用 rg 搜索全文。",
                "PowerShell 环境禁止使用 Unix head；如需限制输出，使用 Select-Object -First N。",
                "优先召回与角色、地点、守卫规则、当前状态有关的内容节点。",
                "不要把 retrieval.enabled=false 且只配置 inject 的风格节点当作任务相关召回结果，除非确实说明它是直接注入上下文。",
                "最终必须调用 report_result，data 只返回内容节点路径 string[]，不要输出 reason/notes/summary/title/type/status/state。",
            ],
            maxEntries: options.maxEntries,
        };

        logProgress("dispatch retrieval run");
        await agentSystem.dispatchDetachedSubAgent(retrievalThreadId, input);
        const result = await waitForRetrievalReport(agentSystem, retrievalThreadId, options.timeoutMs);
        logProgress("retrieval report captured");
        const reportText = renderReport({
            workspaceRoot,
            leaderThreadId,
            retrievalThreadId,
            startedAt,
            tools: result.tools,
            report: result.report,
        });

        console.log(reportText);

        if (!options.keep && !options.workspace) {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
            logProgress(`临时 workspace 已清理: ${workspaceRoot}`);
        } else {
            console.log(`\nWorkspace kept: ${workspaceRoot}`);
        }
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        console.error(`\nWorkspace kept for debugging: ${workspaceRoot}`);
        process.exitCode = 1;
    } finally {
        if (options.keepThreads) {
            if (leaderThreadId) {
                console.log(`Leader thread kept: ${leaderThreadId}`);
            }
            if (retrievalThreadId) {
                console.log(`Retrieval thread kept: ${retrievalThreadId}`);
            }
            return;
        }
        if (retrievalThreadId) {
            await agentSystem.deleteThread(retrievalThreadId).catch(() => {});
        }
        if (leaderThreadId) {
            await agentSystem.deleteThread(leaderThreadId).catch(() => {});
        }
    }
}

void main();
