import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";

export const DEFAULT_WRITING_REFERENCE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters";

const WRITING_REFERENCE_DIR_CANDIDATES = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "writing-references"),
    path.join(process.cwd(), "server", "agent", "profiles", "builtin", "writing-references"),
] as const;

const WritingReferenceFrontmatterSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    sourceTitle: z.string().min(1),
    sourceChapters: z.string().min(1),
    generatedFrom: z.string().min(1),
});

export type WritingReferenceDefinition = z.infer<typeof WritingReferenceFrontmatterSchema> & {
    readonly sourceFile: string;
    readonly content: string;
};

export type WritingReferencePreset = string;

/**
 * 解析可用的 writer 文风参考正文目录。
 */
export async function resolveWritingReferenceDirectory(candidates: readonly string[] = WRITING_REFERENCE_DIR_CANDIDATES): Promise<string> {
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

    throw new Error(`Writing references directory not found. Tried: ${candidates.join(", ")}`);
}

/**
 * 从 writing-references 目录自动发现 Markdown 文风参考正文。
 */
export async function loadWritingReferencePresets(): Promise<WritingReferenceDefinition[]> {
    const writingReferenceDirectory = await resolveWritingReferenceDirectory();
    const entries = await fs.readdir(writingReferenceDirectory, {withFileTypes: true});
    const references: WritingReferenceDefinition[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
        }

        const sourceFile = path.join(writingReferenceDirectory, entry.name);
        const content = await fs.readFile(sourceFile, "utf-8");
        const parsed = parseFrontmatterDocument(content, WritingReferenceFrontmatterSchema);

        if (!parsed.hasFrontmatter) {
            throw new Error(`Writing reference missing frontmatter: ${sourceFile}`);
        }

        references.push({
            ...parsed.metadata,
            sourceFile: path.relative(process.cwd(), sourceFile).split(path.sep).join("/"),
            content: parsed.body,
        });
    }

    return references.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}

/**
 * 构造 writer 文风参考正文提示词。
 * 只把正文暴露给 writer，不暴露 frontmatter、生成来源和 preset key。
 */
export async function buildWritingReference(input: {
    preset?: WritingReferencePreset;
} = {}): Promise<string> {
    const preset = input.preset ?? DEFAULT_WRITING_REFERENCE_PRESET;
    const references = await loadWritingReferencePresets();
    const reference = references.find((item) => item.key === preset);

    if (!reference) {
        throw new Error(`Unknown writing reference preset: ${preset}`);
    }

    const content = reference.content.trim() ? reference.content.trim() : "空";

    return [
        "<writing_reference>",
        content,
        "</writing_reference>",
    ].join("\n");
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
