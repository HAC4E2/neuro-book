import {createHash} from "node:crypto";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    ILLUSTRATION_CHAPTER_PARSER_VERSION,
    IllustrationSelectionInputSchema,
    type IllustrationSelectionInput,
} from "nbook/shared/text-to-image-illustration-planning";

export type IllustrationChapterBlockKind = "paragraph" | "heading" | "list" | "blockquote" | "frontmatter" | "code" | "html" | "managed" | "thematic-break";

export type IllustrationChapterBlock = {
    kind: IllustrationChapterBlockKind;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    rawText: string;
    normalizedText: string;
    textHash: string;
    /** null 表示该 block 不是合法插图锚点。 */
    anchorId: string | null;
};

export type IllustrationAnchorCandidate = {
    anchorId: string;
    kind: "paragraph" | "heading" | "list" | "blockquote";
    startLine: number;
    endLine: number;
    normalizedText: string;
    textHash: string;
};

export type IllustrationChapterSnapshot = {
    schemaVersion: "nbook.illustration-chapter-snapshot/v1";
    parserVersion: typeof ILLUSTRATION_CHAPTER_PARSER_VERSION;
    chapterPath: string;
    markdown: string;
    chapterFileHash: string;
    sourceChapterHash: string;
    blocks: IllustrationChapterBlock[];
    anchorCandidates: IllustrationAnchorCandidate[];
};

export type IllustrationSelectionSnapshot = {
    schemaVersion: "nbook.illustration-selection-snapshot/v1";
    selectedText: string;
    selectedTextHash: string;
    selectionHash: string;
    startAnchorId: string;
    endAnchorId: string;
    insertAfterAnchorId: string;
    startBlockOffset: number;
    endBlockOffset: number;
    contextBefore: IllustrationAnchorCandidate[];
    contextAfter: IllustrationAnchorCandidate[];
};

/** 选区定位、冲突或权限边界的稳定错误。 */
export class IllustrationSelectionError extends Error {
    constructor(readonly code: "ILLUSTRATION_CHAPTER_CONFLICT" | "ILLUSTRATION_SELECTION_AMBIGUOUS" | "ILLUSTRATION_SELECTION_FORBIDDEN" | "ILLUSTRATION_SELECTION_NOT_FOUND", message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationSelectionError";
    }
}

type SourceLine = {content: string; startOffset: number; endOffset: number; lineNumber: number};

/** 已保存章节的确定性 block parser；浏览器坐标只用于定位，不成为锚点真相源。 */
export class IllustrationChapterParser {
    /** 解析章节并同时生成精确 file hash、清理后 source hash 与稳定顶层锚点。 */
    parse(input: {chapterPath: string; markdown: string}): IllustrationChapterSnapshot {
        const chapterPath = normalizeChapterPath(input.chapterPath);
        const rawMarkdown = input.markdown;
        const markdown = rawMarkdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        const lines = splitLines(markdown);
        const drafts = parseBlocks(lines, markdown);
        let anchorIndex = 0;
        const blocks = drafts.map((draft): IllustrationChapterBlock => {
            const normalizedText = normalizeBlockText(draft.kind, draft.rawText);
            const textHash = hashTextToImageContract({kind: draft.kind, normalizedText});
            const anchorId = isAnchorKind(draft.kind) && normalizedText.length > 0
                ? createAnchorId(draft.kind, anchorIndex++, textHash)
                : null;
            return {...draft, normalizedText, textHash, anchorId};
        });
        const anchorCandidates = blocks.flatMap((block): IllustrationAnchorCandidate[] => block.anchorId && isAnchorKind(block.kind) ? [{
            anchorId: block.anchorId,
            kind: block.kind,
            startLine: block.startLine,
            endLine: block.endLine,
            normalizedText: block.normalizedText,
            textHash: block.textHash,
        }] : []);
        const sourceChapterHash = hashTextToImageContract({
            schemaVersion: "nbook.illustration-source-chapter/v1",
            parserVersion: ILLUSTRATION_CHAPTER_PARSER_VERSION,
            blocks: blocks.flatMap((block) => block.kind === "managed" || block.kind === "frontmatter" ? [] : [{
                kind: block.kind,
                normalizedText: block.normalizedText,
            }]),
        });
        return {
            schemaVersion: "nbook.illustration-chapter-snapshot/v1",
            parserVersion: ILLUSTRATION_CHAPTER_PARSER_VERSION,
            chapterPath,
            markdown,
            chapterFileHash: hashBytes(rawMarkdown),
            sourceChapterHash,
            blocks,
            anchorCandidates,
        };
    }

    /** 在服务端章节快照上消歧选区，并固定最后一个相交顶层正文 block 为插入点。 */
    select(snapshot: IllustrationChapterSnapshot, input: IllustrationSelectionInput): IllustrationSelectionSnapshot {
        const request = IllustrationSelectionInputSchema.parse(input);
        if (request.chapterFileHash !== snapshot.chapterFileHash) {
            throw new IllustrationSelectionError("ILLUSTRATION_CHAPTER_CONFLICT", "章节已在捕获选区后发生变化");
        }
        const occurrences = findOccurrences(snapshot.markdown, request.selectedText).filter((occurrence) => {
            const startLine = lineAt(snapshot.markdown, occurrence.start);
            const endLine = lineAt(snapshot.markdown, Math.max(occurrence.start, occurrence.end - 1));
            return startLine >= request.lineRange.startLine && endLine <= request.lineRange.endLine;
        });
        const selected = chooseOccurrence(occurrences, request);
        const intersecting = snapshot.blocks.filter((block) => selected.start < block.endOffset && selected.end > block.startOffset);
        if (intersecting.some((block) => !isAnchorKind(block.kind))) {
            throw new IllustrationSelectionError("ILLUSTRATION_SELECTION_FORBIDDEN", "选区不能包含 frontmatter、代码、HTML 或受管节点");
        }
        const selectedBlocks = intersecting.filter((block): block is IllustrationChapterBlock & {anchorId: string} => block.anchorId !== null);
        if (selectedBlocks.length === 0) {
            throw new IllustrationSelectionError("ILLUSTRATION_SELECTION_NOT_FOUND", "选区没有相交的顶层正文 block");
        }
        const first = selectedBlocks[0]!;
        const last = selectedBlocks[selectedBlocks.length - 1]!;
        const selectedText = normalizeSelectedText(request.selectedText);
        if (!selectedText) throw new IllustrationSelectionError("ILLUSTRATION_SELECTION_NOT_FOUND", "选区没有非空正文");
        const selectedTextHash = hashTextToImageContract({selectedText});
        const startBlockOffset = normalizedOffset(snapshot.markdown.slice(first.startOffset, selected.start));
        const endBlockOffset = normalizedOffset(snapshot.markdown.slice(last.startOffset, selected.end));
        const selectionHash = hashTextToImageContract({
            schemaVersion: "nbook.illustration-selection/v1",
            parserVersion: ILLUSTRATION_CHAPTER_PARSER_VERSION,
            selectedTextHash,
            startAnchorId: first.anchorId,
            endAnchorId: last.anchorId,
            startBlockOffset,
            endBlockOffset,
        });
        const eligible = snapshot.blocks.filter((block): block is IllustrationChapterBlock & {anchorId: string} => block.anchorId !== null);
        const firstIndex = eligible.findIndex((block) => block.anchorId === first.anchorId);
        const lastIndex = eligible.findIndex((block) => block.anchorId === last.anchorId);
        return {
            schemaVersion: "nbook.illustration-selection-snapshot/v1",
            selectedText,
            selectedTextHash,
            selectionHash,
            startAnchorId: first.anchorId,
            endAnchorId: last.anchorId,
            insertAfterAnchorId: last.anchorId,
            startBlockOffset,
            endBlockOffset,
            contextBefore: eligible.slice(Math.max(0, firstIndex - 2), firstIndex).map(toAnchorCandidate),
            contextAfter: eligible.slice(lastIndex + 1, lastIndex + 3).map(toAnchorCandidate),
        };
    }
}

function parseBlocks(lines: SourceLine[], markdown: string): Array<Omit<IllustrationChapterBlock, "normalizedText" | "textHash" | "anchorId">> {
    const blocks: Array<Omit<IllustrationChapterBlock, "normalizedText" | "textHash" | "anchorId">> = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index]!;
        if (!line.content.trim()) {
            index += 1;
            continue;
        }
        let kind: IllustrationChapterBlockKind;
        let endIndex = index;
        if (index === 0 && line.content.trim() === "---") {
            kind = "frontmatter";
            endIndex = findClosingLine(lines, index + 1, /^(---|\.\.\.)\s*$/u);
        } else if (/^\s*(`{3,}|~{3,})/u.test(line.content)) {
            kind = "code";
            const marker = /^\s*(`{3,}|~{3,})/u.exec(line.content)?.[1] ?? "```";
            endIndex = findClosingLine(lines, index + 1, new RegExp(`^\\s*${escapeRegex(marker[0] ?? "`")}{${String(marker.length)},}\\s*$`, "u"));
        } else if (/^\s*<text-to-image-prompt(?:\s|>)/u.test(line.content)) {
            kind = "managed";
            endIndex = findClosingLine(lines, index, /^\s*<\/text-to-image-prompt>\s*$/u);
        } else if (/^\s*</u.test(line.content)) {
            kind = "html";
            endIndex = findContiguousEnd(lines, index);
        } else if (/^\s{0,3}(?:[-+*]\s+|\d+[.)]\s+)/u.test(line.content)) {
            kind = "list";
            endIndex = findContiguousEnd(lines, index);
        } else if (/^\s{0,3}>/u.test(line.content)) {
            kind = "blockquote";
            while (endIndex + 1 < lines.length && /^\s{0,3}>/u.test(lines[endIndex + 1]!.content)) endIndex += 1;
        } else if (/^\s{0,3}#{1,6}\s+/u.test(line.content)) {
            kind = "heading";
        } else if (/^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/u.test(line.content)) {
            kind = "thematic-break";
        } else {
            kind = "paragraph";
            while (endIndex + 1 < lines.length && lines[endIndex + 1]!.content.trim() && !startsSpecialBlock(lines[endIndex + 1]!.content)) endIndex += 1;
        }
        const start = lines[index]!;
        const end = lines[endIndex] ?? lines[lines.length - 1]!;
        blocks.push({
            kind,
            startOffset: start.startOffset,
            endOffset: end.endOffset,
            startLine: start.lineNumber,
            endLine: end.lineNumber,
            rawText: markdown.slice(start.startOffset, end.endOffset),
        });
        index = endIndex + 1;
    }
    return blocks;
}

function splitLines(markdown: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let offset = 0;
    const parts = markdown.split("\n");
    parts.forEach((content, index) => {
        const endOffset = offset + content.length;
        lines.push({content, startOffset: offset, endOffset, lineNumber: index + 1});
        offset = endOffset + 1;
    });
    return lines;
}

function findClosingLine(lines: SourceLine[], start: number, pattern: RegExp): number {
    for (let index = start; index < lines.length; index += 1) {
        if (pattern.test(lines[index]!.content)) return index;
    }
    return lines.length - 1;
}

function findContiguousEnd(lines: SourceLine[], start: number): number {
    let end = start;
    while (end + 1 < lines.length && lines[end + 1]!.content.trim()) end += 1;
    return end;
}

function startsSpecialBlock(value: string): boolean {
    return /^\s*(?:`{3,}|~{3,}|<|>|#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/u.test(value);
}

function normalizeBlockText(kind: IllustrationChapterBlockKind, rawText: string): string {
    if (kind === "managed" || kind === "frontmatter") return "";
    const lines = rawText.split("\n").map((line) => {
        if (kind === "heading") return line.replace(/^\s{0,3}#{1,6}\s+/u, "");
        if (kind === "list") return line.replace(/^\s{0,3}(?:[-+*]\s+|\d+[.)]\s+)/u, "");
        if (kind === "blockquote") return line.replace(/^\s{0,3}>\s?/u, "");
        return line;
    });
    return normalizeSelectedText(lines.join("\n"));
}

function normalizeSelectedText(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function normalizedOffset(value: string): number {
    return normalizeSelectedText(value).length;
}

function isAnchorKind(kind: IllustrationChapterBlockKind): kind is "paragraph" | "heading" | "list" | "blockquote" {
    return kind === "paragraph" || kind === "heading" || kind === "list" || kind === "blockquote";
}

function createAnchorId(kind: "paragraph" | "heading" | "list" | "blockquote", index: number, textHash: string): string {
    const prefix = kind === "paragraph" ? "p" : kind === "heading" ? "h" : kind === "list" ? "l" : "q";
    return `${prefix}_${String(index + 1).padStart(4, "0")}_${textHash.slice("sha256:".length, "sha256:".length + 8)}`;
}

function findOccurrences(markdown: string, selectedText: string): Array<{start: number; end: number}> {
    const occurrences: Array<{start: number; end: number}> = [];
    let cursor = 0;
    while (cursor <= markdown.length - selectedText.length) {
        const start = markdown.indexOf(selectedText, cursor);
        if (start < 0) break;
        occurrences.push({start, end: start + selectedText.length});
        cursor = start + Math.max(1, selectedText.length);
    }
    return occurrences;
}

function chooseOccurrence(
    occurrences: Array<{start: number; end: number}>,
    request: IllustrationSelectionInput,
): {start: number; end: number} {
    if (occurrences.length === 0) {
        throw new IllustrationSelectionError("ILLUSTRATION_SELECTION_NOT_FOUND", "已保存章节中找不到精确选中文字");
    }
    if (occurrences.length === 1) return occurrences[0]!;
    if (request.textRange) {
        const exact = occurrences.filter((item) => item.start === request.textRange!.startOffset && item.end === request.textRange!.endOffset);
        if (exact.length === 1) return exact[0]!;
    }
    throw new IllustrationSelectionError("ILLUSTRATION_SELECTION_AMBIGUOUS", "选中文字在定位范围内仍不唯一");
}

function lineAt(markdown: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < Math.min(offset, markdown.length); index += 1) if (markdown[index] === "\n") line += 1;
    return line;
}

function toAnchorCandidate(block: IllustrationChapterBlock & {anchorId: string}): IllustrationAnchorCandidate {
    if (!isAnchorKind(block.kind)) throw new Error("ILLUSTRATION_ANCHOR_INVALID");
    return {
        anchorId: block.anchorId,
        kind: block.kind,
        startLine: block.startLine,
        endLine: block.endLine,
        normalizedText: block.normalizedText,
        textHash: block.textHash,
    };
}

function normalizeChapterPath(value: string): string {
    const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!/^manuscript\/.+\.md$/u.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
        throw new Error("ILLUSTRATION_CHAPTER_PATH_INVALID");
    }
    return normalized;
}

function hashBytes(value: string): string {
    return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
