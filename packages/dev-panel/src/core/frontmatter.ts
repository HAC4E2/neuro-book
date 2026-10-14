import {parse as parseYaml} from "yaml";
import {NbdevError} from "./errors.js";

export {readSection} from "./sections.js";

/** 与治理检查 `readTaskFrontmatter` 相同的定界。 */
const FRONTMATTER_PATTERN = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export type ParsedFrontmatter =
    | {ok: true; data: Record<string, unknown>; body: string}
    | {ok: false; reason: "missing" | "unparsable" | "not_object"; body: string; error?: string};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFrontmatter(text: string): ParsedFrontmatter {
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match) return {ok: false, reason: "missing", body: text};
    const body = text.slice(match[0].length);
    let value: unknown;
    try {
        value = parseYaml(match[2] ?? "");
    } catch (error) {
        return {ok: false, reason: "unparsable", body, error: error instanceof Error ? error.message : String(error)};
    }
    if (!isRecord(value)) return {ok: false, reason: "not_object", body};
    return {ok: true, data: value, body};
}

/**
 * 按行改写 frontmatter 里的简单标量字段：替换已有的 `key:` 行，没有就插在结束的 `---` 之前。
 * 不重新序列化整个 YAML，保留原有的字段顺序、引号与注释；改完重新解析核对。
 */
export function setFrontmatterFields(text: string, fields: Readonly<Record<string, string>>): string {
    const match = FRONTMATTER_PATTERN.exec(text);
    if (!match) throw new NbdevError("invalid_record", "记录缺少 frontmatter，无法改写字段");
    const newline = match[1] ?? "\n";
    const lines = (match[2] ?? "").split(/\r?\n/u);
    for (const [key, value] of Object.entries(fields)) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(key) || !/^[A-Za-z0-9-]+$/u.test(value)) {
            throw new NbdevError("internal", `frontmatter 字段只支持简单标量：${key}`);
        }
        const index = lines.findIndex((line) => line.startsWith(`${key}:`));
        if (index >= 0) lines[index] = `${key}: ${value}`;
        else lines.push(`${key}: ${value}`);
    }
    const rewritten = `---${newline}${lines.join(newline)}${newline}---${newline}${text.slice(match[0].length)}`;
    const parsed = parseFrontmatter(rewritten);
    if (!parsed.ok) throw new NbdevError("invalid_record", `改写后的 frontmatter 无法解析：${parsed.reason}`);
    for (const [key, value] of Object.entries(fields)) {
        if (parsed.data[key] !== value) throw new NbdevError("invalid_record", `改写后的 frontmatter 字段不一致：${key}`);
    }
    return rewritten;
}

/** 正文第一个一级标题。 */
export function readTitle(body: string): string | null {
    for (const line of body.split(/\r?\n/u)) {
        if (line.startsWith("# ")) return line.slice(2).trim() || null;
    }
    return null;
}

/** 一级标题之后的第一段正文（不含标题、表格与代码块）。 */
export function firstParagraph(body: string): string | null {
    const lines = body.split(/\r?\n/u);
    const titleIndex = lines.findIndex((line) => line.startsWith("# "));
    const paragraph: string[] = [];
    for (const line of lines.slice(titleIndex + 1)) {
        const trimmed = line.trim();
        if (trimmed === "") {
            if (paragraph.length > 0) break;
            continue;
        }
        if (/^(#|\||```|---)/u.test(trimmed)) {
            if (paragraph.length > 0) break;
            continue;
        }
        paragraph.push(trimmed);
    }
    return paragraph.length > 0 ? paragraph.join(" ") : null;
}
