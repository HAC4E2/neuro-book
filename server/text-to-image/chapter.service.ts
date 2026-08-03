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
