import path from "node:path";
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {toLangChainTool} from "nbook/server/agent/tools/agent-tool";
import {readFileTool} from "nbook/server/agent/tools/file/read-file.tool";

describe("readFileTool", () => {
    let workspaceRoot: string;
    let containerWorkspaceRoot: string;

    beforeEach(async () => {
        workspaceRoot = path.join(".agent", "read-file-tool-test", randomUUID());
        containerWorkspaceRoot = path.join("workspace", `__agent-read-file-test-${randomUUID()}`);
        await fs.mkdir(path.join(workspaceRoot, "lorebook", "character", "银龙姬"), {recursive: true});
        await fs.writeFile(path.join(workspaceRoot, "lorebook", "character", "银龙姬", "index.md"), "title: 银龙姬\n", "utf-8");
        await fs.mkdir(path.join(workspaceRoot, ".agent", "plan"), {recursive: true});
        await fs.writeFile(path.join(workspaceRoot, ".agent", "plan", "current.md"), "# 当前计划\n", "utf-8");
        await fs.mkdir(path.join(containerWorkspaceRoot, ".agent", "plan"), {recursive: true});
        await fs.writeFile(path.join(containerWorkspaceRoot, ".agent", "plan", "current.md"), "# 容器计划\n", "utf-8");
    });

    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true});
        await fs.rm(containerWorkspaceRoot, {recursive: true, force: true});
    });

    it("可以读取项目根目录内 workspace 外的文本文件", async () => {
        const result = await readFileTool.execute({
            filePath: path.join(process.cwd(), "AGENTS.md"),
            limit: 1,
        }, {} as AgentToolContext);

        expect(result.content).toContain("1\t# AGENTS.md");
    });

    it("可以把裸 lorebook 中文嵌套路径映射到当前小说 workspace", async () => {
        const result = await readFileTool.execute({
            filePath: "lorebook/character/银龙姬/index.md",
            limit: 1,
        }, createWorkspaceContext(workspaceRoot));

        expect(result.content).toContain("1\ttitle: 银龙姬");
    });

    it("workspace 路径表示容器级路径", async () => {
        const result = await readFileTool.execute({
            filePath: `${containerWorkspaceRoot.replace(/\\/g, "/")}/.agent/plan/current.md`,
            limit: 1,
        }, createWorkspaceContext(workspaceRoot));

        expect(result.content).toContain("1\t# 容器计划");
    });

    it("可以把带 slug 的 workspace 中文嵌套路径映射到当前小说 workspace", async () => {
        const sluggedWorkspaceRoot = path.join(containerWorkspaceRoot, "silver-dragon-hime-read");
        const targetDir = path.join(sluggedWorkspaceRoot, "lorebook", "character", "银龙姬");
        await fs.mkdir(targetDir, {recursive: true});
        await fs.writeFile(path.join(targetDir, "index.md"), "title: 银龙姬\n", "utf-8");

        const result = await readFileTool.execute({
            filePath: `${sluggedWorkspaceRoot.replace(/\\/g, "/")}/lorebook/character/银龙姬/index.md`,
            limit: 1,
        }, createWorkspaceContext(sluggedWorkspaceRoot));

        expect(result.content).toContain("1\ttitle: 银龙姬");
    });

    it("优先在当前小说 workspace 查找普通相对路径", async () => {
        const result = await readFileTool.execute({
            filePath: ".agent/plan/current.md",
            limit: 1,
        }, createWorkspaceContext(workspaceRoot));

        expect(result.content).toContain("1\t# 当前计划");
    });

    it("带 slug 的 workspace 路径不会被剥离成当前小说相对路径", async () => {
        const sluggedWorkspaceRoot = path.join(containerWorkspaceRoot, "silver-dragon-hime");
        const targetDir = path.join(sluggedWorkspaceRoot, ".agent", "plan");
        await fs.mkdir(targetDir, {recursive: true});
        await fs.writeFile(path.join(targetDir, "current.md"), "# slug 计划\n", "utf-8");

        const result = await readFileTool.execute({
            filePath: `${sluggedWorkspaceRoot.replace(/\\/g, "/")}/.agent/plan/current.md`,
            limit: 1,
        }, createWorkspaceContext(sluggedWorkspaceRoot));

        expect(result.content).toContain("1\t# slug 计划");
    });

    it("包装层会把缺失文件错误压成短 ToolMessage", async () => {
        const tool = toLangChainTool(readFileTool, createWorkspaceContext(workspaceRoot));
        const result = await tool.invoke({
            filePath: ".agent/plan/missing.md",
        }, {
            toolCall: {
                id: "call-read-missing",
                name: "read_file",
                args: {
                    filePath: ".agent/plan/missing.md",
                },
            },
        });

        expect(result.status).toBe("error");
        expect(result.text).toBe("File not found: .agent/plan/missing.md");
        expect(result.text).not.toContain("at async");
        expect(result.text).not.toContain(".nuxt/dev/index.mjs");
        expect(result.text).not.toContain("node_modules");
        expect(JSON.stringify(result.additional_kwargs)).not.toContain("stack");
    });
});

/**
 * 构造只包含 workspace scope 的工具上下文。
 */
function createWorkspaceContext(workspace: string): AgentToolContext {
    return {
        getScope: () => ({
            studio: {workspace},
        }),
    } as AgentToolContext;
}
