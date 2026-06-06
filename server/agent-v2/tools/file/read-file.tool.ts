import {z} from "zod";
import type {AgentTool, AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {recordContextAccess} from "nbook/server/agent/context-access/lorebook-context-access";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {resolveAgentFileTarget} from "nbook/server/agent/tools/file/workspace-file-target";

const ReadFileInputSchema = z.object({
    filePath: z.string().trim().min(1, "filePath is required").describe("Project-relative path, absolute path within the project root, or workspace/... path to a text file. workspace/... maps to the active novel workspace."),
    offset: z.number().int().min(1, "offset must be at least 1").optional().describe("1-based starting line number. Defaults to the first line."),
    limit: z.number().int().min(1, "limit must be at least 1").optional().default(2000).describe("Maximum number of lines to read. Defaults to 2000."),
});

/**
 * 读取指定资源内容。
 */
export const readFileTool: AgentTool<typeof ReadFileInputSchema> = {
    key: "read_file",
    description: [
        "Read the content of a local text file within the project root.",
        "Returns content with line numbers (format: lineNumber\\tcontent).",
        "Use offset (1-based) to skip lines and limit to cap the number of lines returned.",
        "Inspect existing files before editing when the change depends on their current content.",
    ].join("\n"),
    schema: ReadFileInputSchema,
    async execute(input, context) {
        const {filePath, offset, limit} = input;
        const target = await resolveAgentFileTarget(context, filePath);
        const content = await readWorkspaceTextFile(target.root, target.filePath);
        await recordReadAccess(context, target);
        const allLines = content.split("\n");
        const lines: string[] = [];
        const startLine = offset ?? 1;
        const endLine = Math.min(allLines.length, startLine + limit - 1);

        for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
            const lineIndex = lineNumber - 1;
            if (lineIndex >= 0 && lineIndex < allLines.length) {
                lines.push(`${String(lineNumber)}\t${allLines[lineIndex]!}`);
            }
        }

        const result = lines.length > 0
            ? lines.join("\n")
            : `File is empty or offset(${String(startLine)}) is beyond total line count(${String(allLines.length)})`;

        return createToolResultMessage(result, JSON.stringify({filePath, offset, limit}));
    },
};

type ResolvedFileTarget = {root: string; filePath: string};

async function recordReadAccess(context: AgentToolContext, target: ResolvedFileTarget): Promise<void> {
    const scope = context.getScope();
    if (scope.studio.workspaceKind !== "novel" || !scope.studio.workspace) {
        return;
    }
    const project = resolveProjectTarget(scope.studio.workspace, target);
    if (!project) {
        return;
    }
    try {
        await recordContextAccess({
            projectRoot: project.root,
            projectSlug: project.slug,
            profileKey: context.profileKey,
            sessionId: String(context.threadId),
            filePath: project.filePath,
        });
    } catch {
        // 访问推荐是辅助状态，不能影响 read_file 主流程。
    }
}

function resolveProjectTarget(workspaceRoot: string, target: ResolvedFileTarget): {root: string; slug: string; filePath: string} | null {
    const normalizedWorkspace = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
    const slug = normalizedWorkspace.split("/").filter(Boolean).at(-1);
    if (!slug) {
        return null;
    }
    const normalizedRoot = target.root.replace(/\\/g, "/").replace(/\/+$/g, "");
    const normalizedPath = target.filePath.replace(/\\/g, "/").replace(/^\/+/g, "");
    if (normalizedRoot === normalizedWorkspace) {
        return {root: normalizedWorkspace, slug, filePath: normalizedPath};
    }
    const workspacePrefix = `${normalizedWorkspace}/`;
    if (`${normalizedRoot}/`.startsWith(workspacePrefix)) {
        const rootRemainder = normalizedRoot.slice(workspacePrefix.length);
        return {root: normalizedWorkspace, slug, filePath: `${rootRemainder}/${normalizedPath}`.replace(/^\/+/g, "")};
    }
    if (normalizedRoot === "workspace" && normalizedPath.startsWith(`${slug}/`)) {
        return {root: normalizedWorkspace, slug, filePath: normalizedPath.slice(slug.length + 1)};
    }
    return null;
}
