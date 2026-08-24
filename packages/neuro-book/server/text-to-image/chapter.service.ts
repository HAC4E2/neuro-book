import fs from "node:fs/promises";
import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {
    findTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

/** 读取章节 Markdown 文本；路径越界由 workspace-files 层拒绝。 */
export async function readChapterMarkdown(root: AbsoluteFsPath, chapterPath: string): Promise<string> {
    return await readWorkspaceTextFile(root, chapterPath);
}

export type SameVolumeHistoryEntry = {
    path: string;
    content: string;
};

/**
 * Read preceding chapter copies from the same manuscript volume.
 * The `<image>` blocks are removed from the returned copy only; source files remain unchanged.
 */
export async function readSameVolumeHistory(
    root: AbsoluteFsPath,
    chapterPath: string,
    depth: number,
): Promise<SameVolumeHistoryEntry[]> {
    if (!Number.isInteger(depth) || depth <= 0) {
        return [];
    }
    const normalizedPath = chapterPath.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    const segments = normalizedPath.split("/");
    const chapterFile = segments.at(-1)?.toLowerCase();
    const chapterDirectory = segments.at(-2);
    if (
        segments.length < 4
        || segments[0] !== "manuscript"
        || chapterFile !== "index.md"
        || !chapterDirectory
    ) {
        return [];
    }

    const volumeRoot = path.join(root, ...segments.slice(0, -2));
    let directoryEntries: Array<{name: string; isDirectory(): boolean}>;
    try {
        directoryEntries = await fs.readdir(volumeRoot, {withFileTypes: true});
    } catch (error) {
        if (isFileNotFound(error)) {
            return [];
        }
        throw error;
    }
    const chapterDirectories = (await Promise.all(directoryEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
            try {
                const stat = await fs.stat(path.join(volumeRoot, entry.name, "index.md"));
                return stat.isFile() ? entry.name : null;
            } catch (error) {
                if (isFileNotFound(error)) return null;
                throw error;
            }
        })))
        .filter((name): name is string => name !== null)
        .sort(compareChapterDirectoryNames);
    const currentIndex = chapterDirectories.indexOf(chapterDirectory);
    if (currentIndex <= 0) {
        return [];
    }

    const previousDirectories = chapterDirectories.slice(
        Math.max(0, currentIndex - Math.min(depth, 20)),
        currentIndex,
    );
    const result: SameVolumeHistoryEntry[] = [];
    for (const previousDirectory of previousDirectories) {
        const relativePath = `${segments.slice(0, -2).join("/")}/${previousDirectory}/index.md`;
        try {
            const content = await readWorkspaceTextFile(root, relativePath);
            result.push({path: relativePath, content: stripImageBlocksForPrompt(content)});
        } catch (error) {
            if (!isFileNotFound(error)) {
                throw error;
            }
        }
    }
    return result;
}

/** 把指定占位符替换为已生成资产的标准 Markdown 图片引用；找不到时抛错。 */
export function replacePromptPlaceholderWithAsset(
    content: string,
    placeholderId: string,
    asset: TextToImageAssetDto,
): string {
    const matched = findTextToImagePromptMarkdown(content, placeholderId);
    if (!matched) {
        throw new Error(`未找到占位符：${placeholderId}`);
    }
    return content.replace(matched.raw, renderTextToImageAssetMarkdown(asset));
}

function stripImageBlocksForPrompt(content: string): string {
    return content
        .replace(/<image>[\s\S]*?<\/image>/giu, "")
        .replace(/\n[ \t]*\n[ \t]*\n/gu, "\n\n")
        .trim();
}

function compareChapterDirectoryNames(left: string, right: string): number {
    const leftNumber = Number.parseInt(/^(\d+)/u.exec(left)?.[1] ?? "", 10);
    const rightNumber = Number.parseInt(/^(\d+)/u.exec(right)?.[1] ?? "", 10);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
