import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {lock} from "proper-lockfile";
import {
    findTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import type {IllustrationExecutionSource} from "nbook/shared/text-to-image-execution";
import {USER_LOCAL_ACTOR, writeResolvedProjectTextFileTracked} from "nbook/server/workspace-history/tracked-workspace-files";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

export type TextToImageChapterSnapshot = {
    projectPath: string;
    chapterPath: string;
    markdown: string;
    hash: string;
};

/** 章节文件读取与 V2 placeholder 精确结果替换服务。 */
export class TextToImageChapterService {
    constructor(private readonly requireProjectOpen = true) {}

    /** 读取章节不可变快照并返回精确 UTF-8 字节 hash。 */
    async snapshot(projectPath: string, chapterPath: string): Promise<TextToImageChapterSnapshot> {
        const resolved = this.resolve(projectPath, chapterPath);
        const markdown = await fs.readFile(resolved.absolutePath, "utf8");
        return {projectPath, chapterPath: resolved.chapterPath, markdown, hash: hashMarkdown(markdown)};
    }

    /**
     * Route B 结果只替换与 CompiledRequest source 全字段一致的 V2 placeholder。
     * canonical Asset Markdown 已存在时视为同一结果的幂等恢复，不追加第二份图片。
     */
    async replaceIllustrationPrompt(input: {
        projectPath: string;
        source: IllustrationExecutionSource;
        asset: TextToImageAssetDto;
    }): Promise<"inserted" | "missing" | "mismatch"> {
        return await this.withLockedChapter(input.projectPath, input.source.chapterPath, async (current, resolved) => {
            const renderedAsset = renderTextToImageAssetMarkdown(input.asset);
            const prompt = findTextToImagePromptMarkdown(current, input.source.placeholderId);
            if (!prompt) return current.includes(renderedAsset) ? "inserted" : "missing";
            if (prompt.payload.shotId !== input.source.shotId
                || prompt.payload.shotIntentHash !== input.source.shotIntentHash
                || prompt.payload.sourceChapterHash !== input.source.sourceChapterHash
                || prompt.payload.anchorId !== input.source.anchorId
                || prompt.payload.origin !== input.source.shotOrigin) {
                return "mismatch";
            }
            const next = current.replace(prompt.raw, renderedAsset);
            await writeResolvedProjectTextFileTracked({
                projectPath: input.projectPath,
                projectRoot: resolved.projectRoot,
                filePath: resolved.chapterPath,
                content: next,
                actor: USER_LOCAL_ACTOR,
                knownBefore: current,
            });
            return "inserted";
        });
    }

    /** 解析并限制 Project-relative 章节路径。 */
    private resolve(projectPath: string, chapterPath: string): {projectRoot: string; chapterPath: string; absolutePath: string} {
        if (this.requireProjectOpen) assertProjectOpenForRoot(projectPath);
        const normalized = chapterPath.replaceAll("\\", "/").replace(/^\/+/, "");
        if (!/^manuscript\/.+\.md$/u.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
            throw new Error("正文生图只允许操作 manuscript/ 下的 Markdown 章节。");
        }
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        const absolutePath = path.resolve(projectRoot, normalized);
        const relative = path.relative(projectRoot, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("章节路径越出 Project Workspace。");
        return {projectRoot, chapterPath: normalized, absolutePath};
    }

    /** 在单章节文件锁内执行精确 read-modify-write。 */
    private async withLockedChapter<T>(
        projectPath: string,
        chapterPath: string,
        operation: (current: string, resolved: {projectRoot: string; chapterPath: string; absolutePath: string}) => Promise<T>,
    ): Promise<T> {
        const resolved = this.resolve(projectPath, chapterPath);
        const release = await lock(resolved.absolutePath, {retries: {retries: 4, minTimeout: 20, maxTimeout: 200}});
        try {
            return await operation(await fs.readFile(resolved.absolutePath, "utf8"), resolved);
        } finally {
            await release();
        }
    }
}

/** 计算章节原始 UTF-8 bytes hash。 */
function hashMarkdown(markdown: string): string {
    return createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex");
}
