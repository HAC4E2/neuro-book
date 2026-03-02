import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {applyPatchTool} from "nbook/server/agent/tools/file/apply-patch.tool";
import {editFileTool} from "nbook/server/agent/tools/file/edit-file.tool";
import {writeFileTool} from "nbook/server/agent/tools/file/write-file.tool";

const toolContext = {
    agentGateway: {} as never,
    threadId: "1",
    profileKey: "leader.default",
    profile: {
        key: "leader.default",
    } as never,
    runOptions: {},
    writeToolOutput: () => {},
    getHistory: async () => [],
    getScope: () => ({
        studio: {
            workspace: null,
        },
    }) as never,
    setIde: () => ({}) as never,
    setStudio: () => ({}) as never,
} as AgentToolContext;

describe("file write/edit tools", () => {
    let root: string;

    beforeEach(async () => {
        root = path.join(".agent", "file-tool-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("write_file 可以直接创建新文本文件", async () => {
        const filePath = path.resolve(root, "created.yaml");

        await writeFileTool.execute({
            filePath,
            content: "slug: test\n",
            append: false,
        }, toolContext);

        await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("slug: test\n");
    });

    it("edit_file 默认不要求最近 read_file", async () => {
        const filePath = path.resolve(root, "note.md");
        await fs.writeFile(filePath, "old text\n", "utf-8");

        await editFileTool.execute({
            filePath,
            oldString: "old text",
            newString: "new text",
            replaceAll: false,
        }, toolContext);

        await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("new text\n");
    });

    it("apply_patch 默认不要求最近 read_file", async () => {
        const filePath = path.resolve(root, "note.md");
        await fs.writeFile(filePath, "old text\n", "utf-8");

        await applyPatchTool.execute({
            filePath,
            patch: [
                "--- a/note.md",
                "+++ b/note.md",
                "@@ -1,1 +1,1 @@",
                "-old text",
                "+new text",
                "",
            ].join("\n"),
            fuzzFactor: 0,
        }, toolContext);

        await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("new text\n");
    });
});
