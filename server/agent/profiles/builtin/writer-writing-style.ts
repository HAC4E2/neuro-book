import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";

export const DEFAULT_WRITING_STYLE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters.style";

const WRITING_STYLE_DIR_CANDIDATES = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "writing-styles"),
    path.join(process.cwd(), "server", "agent", "profiles", "builtin", "writing-styles"),
] as const;

const WritingStyleFrontmatterSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    sourcePreset: z.string().min(1),
    identifier: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean().nullable(),
    role: z.string().nullable(),
});

export type WritingStyleDefinition = z.infer<typeof WritingStyleFrontmatterSchema> & {
    readonly sourceFile: string;
    readonly content: string;
};

export type WritingStylePreset = string;

/**
 * 解析可用的 writer 文风目录。
 */
export async function resolveWritingStyleDirectory(candidates: readonly string[] = WRITING_STYLE_DIR_CANDIDATES): Promise<string> {
    for (const candidate of candidates) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isDirectory()) {
                return candidate;
            }
        } catch (error) {
            if (isFileMissingError(error)) {
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Writing styles directory not found. Tried: ${candidates.join(", ")}`);
}

/**
 * 从 writing-styles 目录自动发现 Markdown 文风预设。
 */
export async function loadWritingStylePresets(): Promise<WritingStyleDefinition[]> {
    const writingStyleDirectory = await resolveWritingStyleDirectory();
    const entries = await fs.readdir(writingStyleDirectory, {withFileTypes: true});
    const styles: WritingStyleDefinition[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
        }

        const sourceFile = path.join(writingStyleDirectory, entry.name);
        const content = await fs.readFile(sourceFile, "utf-8");
        const parsed = parseFrontmatterDocument(content, WritingStyleFrontmatterSchema);

        if (!parsed.hasFrontmatter) {
            throw new Error(`Writing style missing frontmatter: ${sourceFile}`);
        }

        styles.push({
            ...parsed.metadata,
            sourceFile: path.relative(process.cwd(), sourceFile).split(path.sep).join("/"),
            content: parsed.body,
        });
    }

    return styles.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}

/**
 * 构造 writer 文风提示词。
 */
export async function buildWritingStyle(input: {
    preset?: WritingStylePreset;
} = {}): Promise<string> {
    const preset = input.preset ?? DEFAULT_WRITING_STYLE_PRESET;
    const styles = await loadWritingStylePresets();
    const style = styles.find((item) => item.key === preset);

    if (!style) {
        throw new Error(`Unknown writing style preset: ${preset}`);
    }

    const content = style.content.trim() ? style.content : "空";

    return [
        `<writing_style preset="${escapeXmlAttribute(style.label)}" key="${escapeXmlAttribute(style.key)}" source="${escapeXmlAttribute(style.sourcePreset)}">`,
        content,
        "</writing_style>",
    ].join("\n");
}

/**
 * 转义 XML 属性，避免预设名里的符号破坏 prompt 标签。
 */
function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * 判断文件读取错误是否为文件不存在。
 */
function isFileMissingError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && (error as {code?: unknown}).code === "ENOENT",
    );
}
