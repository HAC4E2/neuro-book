export type TextToImageOutfitTag = {
    sourcePath: string;
    owner: string;
    nameCn: string;
    nameEn: string;
    upper: string;
    upperBack: string;
    lower: string;
    lowerBack: string;
};

type OutfitFieldKey = "owner" | "upper" | "upperBack" | "lower" | "lowerBack";

const OUTFIT_FIELD_LABELS: Array<{key: OutfitFieldKey; labels: string[]}> = [
    {key: "owner", labels: ["归属角色", "归属人"]},
    {key: "upper", labels: ["上半身"]},
    {key: "upperBack", labels: ["上半身背面"]},
    {key: "lower", labels: ["下半身"]},
    {key: "lowerBack", labels: ["下半身背面"]},
];

/**
 * 解析独立服装 Markdown，并保留正背面上下半身四组绘图 Tag。
 */
export function parseTextToImageOutfitTags(content: string, input: {sourcePath: string}): TextToImageOutfitTag {
    const title = content.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/mu)?.[1]?.trim() ?? "";
    const names = splitOutfitNames(title);
    const sections = readOutfitSections(content);
    return {
        sourcePath: input.sourcePath,
        owner: normalizeSectionText(sections.get("owner") ?? ""),
        nameCn: names.nameCn,
        nameEn: names.nameEn,
        upper: normalizeSectionText(sections.get("upper") ?? ""),
        upperBack: normalizeSectionText(sections.get("upperBack") ?? ""),
        lower: normalizeSectionText(sections.get("lower") ?? ""),
        lowerBack: normalizeSectionText(sections.get("lowerBack") ?? ""),
    };
}

/**
 * 渲染可由用户直接维护的独立服装 Markdown 文件。
 */
export function renderTextToImageOutfitTagsMarkdown(outfit: TextToImageOutfitTag): string {
    return [
        `# ${renderOutfitName(outfit.nameCn, outfit.nameEn)}`,
        "",
        renderSection("归属角色", outfit.owner),
        renderSection("上半身", outfit.upper),
        renderSection("上半身背面", outfit.upperBack),
        renderSection("下半身", outfit.lower),
        renderSection("下半身背面", outfit.lowerBack),
    ].join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n";
}

/**
 * 按“中文名称/英文名称”渲染服装名称。
 */
export function renderOutfitName(nameCn: string, nameEn: string): string {
    return [nameCn.trim(), nameEn.trim()].filter(Boolean).join("/");
}

/**
 * 解析“中文名称/英文名称”服装名称，首个斜杠作为语言分隔符。
 */
export function splitOutfitNames(value: string): {nameCn: string; nameEn: string} {
    const separatorIndex = value.indexOf("/");
    if (separatorIndex < 0) {
        return {nameCn: value.trim(), nameEn: ""};
    }
    return {
        nameCn: value.slice(0, separatorIndex).trim(),
        nameEn: value.slice(separatorIndex + 1).trim(),
    };
}

function readOutfitSections(content: string): Map<OutfitFieldKey, string> {
    const sections = new Map<OutfitFieldKey, string>();
    let currentKey: OutfitFieldKey | null = null;
    const currentLines: string[] = [];
    const flush = () => {
        if (currentKey) {
            sections.set(currentKey, currentLines.join("\n").trim());
        }
        currentLines.length = 0;
    };

    for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
        const heading = line.match(/^\s{0,3}#{2,6}\s+(.+?)\s*#*\s*$/u);
        if (heading) {
            flush();
            currentKey = resolveOutfitFieldKey(heading[1] ?? "");
            continue;
        }
        if (currentKey) {
            currentLines.push(line);
        }
    }
    flush();
    return sections;
}

function resolveOutfitFieldKey(value: string): OutfitFieldKey | null {
    const normalized = normalizeLabel(value);
    return OUTFIT_FIELD_LABELS.find((field) => field.labels.some((label) => normalizeLabel(label) === normalized))?.key ?? null;
}

function normalizeLabel(value: string): string {
    return value.replace(/[*_`~[\]【】（）()：:]/gu, "").replace(/\s+/gu, "").toLocaleLowerCase();
}

function normalizeSectionText(value: string): string {
    return value
        .split("\n")
        .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/u, "").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

function renderSection(label: string, value: string): string {
    return [`## ${label}`, value.trim()].join("\n").trimEnd() + "\n";
}
