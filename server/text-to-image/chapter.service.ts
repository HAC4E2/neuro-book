import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {lock} from "proper-lockfile";
import {
    findTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
    renderTextToImagePromptMarkdown,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import type {IllustrationExecutionSource} from "nbook/shared/text-to-image-execution";
import {USER_LOCAL_ACTOR, writeResolvedProjectTextFileTracked} from "nbook/server/workspace-history/tracked-workspace-files";
import {resolveProjectAbsolutePath, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

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

    /**
     * 重roll第一步：把已插入的 canonical Asset Markdown 还原为原 V2 placeholder。
     * 只做逐字节精确匹配替换；图片被手工改动或已不在正文时零写入，返回稳定结果码。
     */
    async restoreIllustrationPrompt(input: {
        projectPath: string;
        source: IllustrationExecutionSource;
        asset: TextToImageAssetDto;
    }): Promise<"restored" | "already_placeholder" | "asset_markdown_missing" | "asset_markdown_ambiguous"> {
        return await this.withLockedChapter(input.projectPath, input.source.chapterPath, async (current, resolved) => {
            const existing = findTextToImagePromptMarkdown(current, input.source.placeholderId);
            if (existing) return "already_placeholder";
            const renderedAsset = renderTextToImageAssetMarkdown(input.asset);
            const occurrences = current.split(renderedAsset).length - 1;
            if (occurrences === 0) return "asset_markdown_missing";
            // 用户把同一图片 Markdown 复制到多处时无法确定原插入点，拒绝还原避免占位块落错位置。
            if (occurrences > 1) return "asset_markdown_ambiguous";
            const placeholder = renderTextToImagePromptMarkdown({
                id: input.source.placeholderId,
                schema: "nbook.text-to-image-prompt/v2",
                shotId: input.source.shotId,
                shotIntentHash: input.source.shotIntentHash,
                sourceChapterHash: input.source.sourceChapterHash,
                anchorId: input.source.anchorId,
                origin: input.source.shotOrigin,
            });
            await writeResolvedProjectTextFileTracked({
                projectPath: input.projectPath,
                projectRoot: resolved.projectRoot,
                filePath: resolved.chapterPath,
                content: current.replace(renderedAsset, () => placeholder),
                actor: USER_LOCAL_ACTOR,
                knownBefore: current,
            });
            return "restored";
        });
    }

    /** 解析并限制 Project-relative 章节路径。 */
    private resolve(projectPath: string, chapterPath: string): {projectRoot: string; chapterPath: string; absolutePath: string} {
        if (this.requireProjectOpen) assertProjectOpen(textToImageProjectRef(projectPath));
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
