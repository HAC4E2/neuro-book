import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {lock} from "proper-lockfile";
import {
    findTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
    renderTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";
import {USER_LOCAL_ACTOR, writeResolvedProjectTextFileTracked} from "nbook/server/workspace-history/tracked-workspace-files";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

export type TextToImageChapterSnapshot = {
    projectPath: string;
    chapterPath: string;
    markdown: string;
    hash: string;
};

export type TextToImageChapterParagraph = {
    id: string;
    start: number;
    end: number;
    text: string;
};

/** 章节内容在生成提示词期间被作者改写时的稳定冲突错误。 */
export class TextToImageChapterConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_CHAPTER_CONFLICT";

    constructor() {
        super("正文在生成图片提示词期间已发生变化，请保存后重新生成。");
        this.name = "TextToImageChapterConflictError";
    }
}

/** 以章节文件为唯一真相源的正文生图读写服务。 */
export class TextToImageChapterService {
    /** 读取章节的不可变快照，并返回精确 UTF-8 字节哈希。 */
    async snapshot(projectPath: string, chapterPath: string): Promise<TextToImageChapterSnapshot> {
        const resolved = this.resolve(projectPath, chapterPath);
        const markdown = await fs.readFile(resolved.absolutePath, "utf8");
        return {projectPath, chapterPath: resolved.chapterPath, markdown, hash: hashMarkdown(markdown)};
    }

    /** 在已验证的段落偏移后写入规范占位符；不匹配的条目绝不追加到章节末尾。 */
    async insertPrompts(input: {
        projectPath: string;
        chapterPath: string;
        expectedHash: string;
        paragraphs: TextToImageChapterParagraph[];
        prompts: Array<{afterParagraphId: string; payload: TextToImagePromptPayload}>;
    }): Promise<{inserted: number; skipped: number; hash: string}> {
        return await this.withLockedChapter(input.projectPath, input.chapterPath, async (current, resolved) => {
            if (hashMarkdown(current) !== input.expectedHash) {
                throw new TextToImageChapterConflictError();
            }
            const paragraphs = new Map(input.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
            const seenPromptIds = new Set<string>();
            const insertions: Array<{offset: number; markdown: string}> = [];
            let skipped = 0;
            for (const prompt of input.prompts) {
                const paragraph = paragraphs.get(prompt.afterParagraphId);
                if (!paragraph || seenPromptIds.has(prompt.payload.id) || current.slice(paragraph.start, paragraph.end) !== paragraph.text) {
                    skipped += 1;
                    continue;
                }
                seenPromptIds.add(prompt.payload.id);
                insertions.push({offset: paragraph.end, markdown: renderTextToImagePromptMarkdown(prompt.payload)});
            }
            let next = current;
            for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
                next = `${next.slice(0, insertion.offset)}\n\n${insertion.markdown}${next.slice(insertion.offset)}`;
            }
            if (insertions.length > 0) {
                await writeResolvedProjectTextFileTracked({
                    projectPath: input.projectPath,
                    projectRoot: resolved.projectRoot,
                    filePath: resolved.chapterPath,
                    content: next,
                    actor: USER_LOCAL_ACTOR,
                    knownBefore: current,
                });
            }
            return {inserted: insertions.length, skipped, hash: hashMarkdown(next)};
        });
    }

    /** 精确替换仍存在且结构合法的占位符；无关正文编辑不会阻止替换。 */
    async replacePrompt(input: {
        projectPath: string;
        chapterPath: string;
        promptId: string;
        asset: TextToImageAssetDto;
    }): Promise<"inserted" | "missing"> {
        return await this.withLockedChapter(input.projectPath, input.chapterPath, async (current, resolved) => {
            const prompt = findTextToImagePromptMarkdown(current, input.promptId);
            if (!prompt) {
                return "missing";
            }
            const next = current.replace(prompt.raw, renderTextToImageAssetMarkdown(input.asset));
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

    private resolve(projectPath: string, chapterPath: string): {projectRoot: string; chapterPath: string; absolutePath: string} {
        assertProjectOpenForRoot(projectPath);
        const normalized = chapterPath.replaceAll("\\", "/").replace(/^\/+/, "");
        if (!/^manuscript\/.+\.md$/u.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
            throw new Error("正文生图只允许操作 manuscript/ 下的 Markdown 章节。");
        }
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        const absolutePath = path.resolve(projectRoot, normalized);
        const relative = path.relative(projectRoot, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("章节路径越出 Project Workspace。");
        }
        return {projectRoot, chapterPath: normalized, absolutePath};
    }

    private async withLockedChapter<T>(projectPath: string, chapterPath: string, operation: (current: string, resolved: {projectRoot: string; chapterPath: string; absolutePath: string}) => Promise<T>): Promise<T> {
        const resolved = this.resolve(projectPath, chapterPath);
        const release = await lock(resolved.absolutePath, {retries: {retries: 4, minTimeout: 20, maxTimeout: 200}});
        try {
            return await operation(await fs.readFile(resolved.absolutePath, "utf8"), resolved);
        } finally {
            await release();
        }
    }
}

function hashMarkdown(markdown: string): string {
    return createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex");
}
