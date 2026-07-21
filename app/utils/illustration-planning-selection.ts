import type {InlineEditReference} from "nbook/app/utils/inline-editor-selection";
import {
    IllustrationSelectionInputSchema,
    type IllustrationSelectionInput,
} from "nbook/shared/text-to-image-illustration-planning";

export type IllustrationSelectionCaptureErrorCode =
    | "ILLUSTRATION_SELECTION_RANGE_MISSING"
    | "ILLUSTRATION_SELECTION_NOT_FOUND"
    | "ILLUSTRATION_SELECTION_AMBIGUOUS";

/** 选区规划启动前的浏览器侧失败；服务端仍会对同一输入重新定位与校验。 */
export class IllustrationSelectionCaptureError extends Error {
    constructor(readonly code: IllustrationSelectionCaptureErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationSelectionCaptureError";
    }
}

/**
 * 把 TipTap 选区引用绑定到刚保存的 Markdown 字节快照。
 * 只在行范围内存在唯一精确文本命中时提供 offset；不能证明唯一时失败关闭。
 */
export async function captureIllustrationSelection(
    markdown: string,
    reference: InlineEditReference,
): Promise<IllustrationSelectionInput> {
    if (!reference.range || reference.match !== "unique") {
        throw new IllustrationSelectionCaptureError(
            "ILLUSTRATION_SELECTION_RANGE_MISSING",
            "当前选区没有可验证的 Markdown 行范围",
        );
    }

    const selectedText = reference.text.trim();
    const occurrences: Array<{startOffset: number; endOffset: number}> = [];
    let cursor = 0;
    while (selectedText && cursor <= markdown.length - selectedText.length) {
        const startOffset = markdown.indexOf(selectedText, cursor);
        if (startOffset < 0) break;
        const endOffset = startOffset + selectedText.length;
        const startLine = lineAt(markdown, startOffset);
        const endLine = lineAt(markdown, Math.max(startOffset, endOffset - 1));
        if (startLine >= reference.range.startLine && endLine <= reference.range.endLine) {
            occurrences.push({startOffset, endOffset});
        }
        cursor = startOffset + Math.max(1, selectedText.length);
    }

    if (occurrences.length === 0) {
        throw new IllustrationSelectionCaptureError(
            "ILLUSTRATION_SELECTION_NOT_FOUND",
            "已保存章节的对应行内找不到精确选中文字",
        );
    }
    if (occurrences.length > 1) {
        throw new IllustrationSelectionCaptureError(
            "ILLUSTRATION_SELECTION_AMBIGUOUS",
            "选中文字在对应行内不唯一",
        );
    }

    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
    const chapterFileHash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    return IllustrationSelectionInputSchema.parse({
        selectedText,
        lineRange: reference.range,
        textRange: occurrences[0],
        chapterFileHash,
    });
}

/** 返回 UTF-16 offset 所在的 1-based Markdown 行号。 */
function lineAt(markdown: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < Math.min(offset, markdown.length); index += 1) {
        if (markdown[index] === "\n") line += 1;
    }
    return line;
}
