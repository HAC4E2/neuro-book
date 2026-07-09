import type {TextToImagePromptEngineCharacter} from "nbook/app/utils/text-to-image-prompt-engine";

export type TextToImageCharacterImageTagOutfit = {
    nameCn: string;
    nameEn: string;
};

export type TextToImageCharacterImageTag = {
    id: string;
    sourcePath: string;
    cnName: string;
    cnAliases: string[];
    enName: string;
    profileTraits: string;
    facialAppearance: string;
    facialBack: string;
    upperSfw: string;
    upperBackSfw: string;
    lowerSfw: string;
    lowerBackSfw: string;
    upperNsfw: string;
    upperBackNsfw: string;
    lowerNsfw: string;
    lowerBackNsfw: string;
    negativePrompt: string;
    outfits: TextToImageCharacterImageTagOutfit[];
};

type ImageTagFieldKey = Exclude<keyof TextToImageCharacterImageTag, "id" | "sourcePath" | "cnAliases" | "outfits"> | "outfitList";

const FIELD_LABELS: Array<{key: ImageTagFieldKey; labels: string[]}> = [
    {key: "cnName", labels: ["角色中文名称", "中文名称", "角色中文名"]},
    {key: "enName", labels: ["角色英文名称", "英文名称", "角色英文名"]},
    {key: "profileTraits", labels: ["角色特征", "基础特征", "气质"]},
    {key: "facialAppearance", labels: ["五官外貌", "正面五官外貌", "正面外貌"]},
    {key: "facialBack", labels: ["五官外貌背面", "背面五官外貌", "背面外貌"]},
    {key: "upperSfw", labels: ["上半身 SFW", "上半身SFW"]},
    {key: "upperBackSfw", labels: ["上半身背面 SFW", "上半身背面SFW"]},
    {key: "lowerSfw", labels: ["下半身 SFW", "下半身SFW"]},
    {key: "lowerBackSfw", labels: ["下半身背面 SFW", "下半身背面SFW"]},
    {key: "upperNsfw", labels: ["上半身 NSFW", "上半身NSFW"]},
    {key: "upperBackNsfw", labels: ["上半身背面 NSFW", "上半身背面NSFW"]},
    {key: "lowerNsfw", labels: ["下半身 NSFW", "下半身NSFW"]},
    {key: "lowerBackNsfw", labels: ["下半身背面 NSFW", "下半身背面NSFW"]},
    {key: "negativePrompt", labels: ["负面提示词", "负面词"]},
    {key: "outfitList", labels: ["服装列表", "服装"]},
];

/**
 * 解析角色 image-tags.md。字段以 Markdown 标题分节，标题文字按中文字段名匹配。
 */
export function parseTextToImageCharacterImageTags(content: string, input: {id: string; sourcePath: string}): TextToImageCharacterImageTag {
    const sections = readMarkdownSections(content);
    const readField = (key: ImageTagFieldKey): string => normalizeSectionText(sections.get(key) ?? "");
    const cnName = readField("cnName");
    return {
        id: input.id,
        sourcePath: input.sourcePath,
        cnName,
        cnAliases: splitCnAliases(cnName),
        enName: readField("enName"),
        profileTraits: readField("profileTraits"),
        facialAppearance: readField("facialAppearance"),
        facialBack: readField("facialBack"),
        upperSfw: readField("upperSfw"),
        upperBackSfw: readField("upperBackSfw"),
        lowerSfw: readField("lowerSfw"),
        lowerBackSfw: readField("lowerBackSfw"),
        upperNsfw: readField("upperNsfw"),
        upperBackNsfw: readField("upperBackNsfw"),
        lowerNsfw: readField("lowerNsfw"),
        lowerBackNsfw: readField("lowerBackNsfw"),
        negativePrompt: readField("negativePrompt"),
        outfits: parseOutfits(sections.get("outfitList") ?? ""),
    };
}

/**
 * 转为现有 prompt engine 可消费的角色结构，便于后续复用 $角色$ 展开逻辑。
 */
export function imageTagToPromptEngineCharacter(tag: TextToImageCharacterImageTag): TextToImagePromptEngineCharacter {
    return {
        id: tag.id,
        cnName: tag.cnName,
        enName: tag.enName,
        profileTraits: tag.profileTraits,
        facialAppearance: tag.facialAppearance,
        facialBack: tag.facialBack,
        upperSfw: tag.upperSfw,
        upperBackSfw: tag.upperBackSfw,
        lowerSfw: tag.lowerSfw,
        lowerBackSfw: tag.lowerBackSfw,
        upperNsfw: tag.upperNsfw,
        upperBackNsfw: tag.upperBackNsfw,
        lowerNsfw: tag.lowerNsfw,
        lowerBackNsfw: tag.lowerBackNsfw,
        negativePrompt: tag.negativePrompt,
    };
}

/**
 * 渲染给正文生图 LLM 的紧凑角色 tag 资料包。
 */
export function renderTextToImageCharacterTagsForLlm(tags: TextToImageCharacterImageTag[]): string {
    if (tags.length === 0) {
        return "无命中的角色 image-tags。";
    }
    return tags.map((tag, index) => {
        const lines = [
            `### ${index + 1}. ${tag.cnName || tag.enName || tag.id}`,
            `source: ${tag.sourcePath}`,
            renderLine("角色中文名称", tag.cnName),
            renderLine("角色英文名称", tag.enName),
            renderLine("角色特征", tag.profileTraits),
            renderLine("五官外貌", tag.facialAppearance),
            renderLine("五官外貌背面", tag.facialBack),
            renderLine("上半身 SFW", tag.upperSfw),
            renderLine("上半身背面 SFW", tag.upperBackSfw),
            renderLine("下半身 SFW", tag.lowerSfw),
            renderLine("下半身背面 SFW", tag.lowerBackSfw),
            renderLine("上半身 NSFW", tag.upperNsfw),
            renderLine("上半身背面 NSFW", tag.upperBackNsfw),
            renderLine("下半身 NSFW", tag.lowerNsfw),
            renderLine("下半身背面 NSFW", tag.lowerBackNsfw),
            renderLine("负面提示词", tag.negativePrompt),
            renderLine("服装列表", tag.outfits.map((outfit) => `${outfit.nameCn}|${outfit.nameEn}`).join("\n")),
        ].filter(Boolean);
        return lines.join("\n");
    }).join("\n\n");
}

/**
 * 渲染标准角色 image-tags.md，供角色详情页生成流程写入 Project Workspace。
 */
export function renderTextToImageCharacterImageTagsMarkdown(tag: TextToImageCharacterImageTag): string {
    return [
        "# image-tags",
        "",
        renderSection("角色中文名称", tag.cnName),
        renderSection("角色英文名称", tag.enName),
        renderSection("角色特征", tag.profileTraits),
        renderSection("五官外貌", tag.facialAppearance),
        renderSection("五官外貌背面", tag.facialBack),
        renderSection("上半身 SFW", tag.upperSfw),
        renderSection("上半身背面 SFW", tag.upperBackSfw),
        renderSection("下半身 SFW", tag.lowerSfw),
        renderSection("下半身背面 SFW", tag.lowerBackSfw),
        renderSection("上半身 NSFW", tag.upperNsfw),
        renderSection("上半身背面 NSFW", tag.upperBackNsfw),
        renderSection("下半身 NSFW", tag.lowerNsfw),
        renderSection("下半身背面 NSFW", tag.lowerBackNsfw),
        renderSection("负面提示词", tag.negativePrompt),
        renderSection("服装列表", tag.outfits.map((outfit) => `${outfit.nameCn}|${outfit.nameEn}`).join("\n")),
    ].join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n";
}

function readMarkdownSections(content: string): Map<ImageTagFieldKey, string> {
    const sections = new Map<ImageTagFieldKey, string>();
    let currentKey: ImageTagFieldKey | null = null;
    const currentLines: string[] = [];
    const flush = () => {
        if (!currentKey) {
            currentLines.length = 0;
            return;
        }
        const previous = sections.get(currentKey);
        const text = currentLines.join("\n").trim();
        sections.set(currentKey, [previous, text].filter(Boolean).join("\n"));
        currentLines.length = 0;
    };

    for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
        const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
        if (heading) {
            flush();
            currentKey = resolveFieldKey(heading[1] ?? "");
            continue;
        }
        if (currentKey) {
            currentLines.push(line);
        }
    }
    flush();
    return sections;
}

function resolveFieldKey(label: string): ImageTagFieldKey | null {
    const normalized = normalizeLabel(label);
    return FIELD_LABELS.find((item) => item.labels.some((candidate) => normalizeLabel(candidate) === normalized))?.key ?? null;
}

function normalizeLabel(value: string): string {
    return value
        .replace(/[*_`~[\]【】（）()：:]/gu, "")
        .replace(/\s+/gu, "")
        .toLocaleLowerCase();
}

function normalizeSectionText(value: string): string {
    return value
        .split("\n")
        .map((line) => stripListMarker(line).trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

function stripListMarker(value: string): string {
    return value.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/u, "");
}

function splitCnAliases(value: string): string[] {
    return value
        .split(/[|｜]/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseOutfits(value: string): TextToImageCharacterImageTagOutfit[] {
    return value
        .split(/\r?\n/u)
        .map((line) => stripListMarker(line).trim())
        .filter(Boolean)
        .map((line) => {
            const [nameCn = "", ...englishParts] = line.split(/[|｜]/u);
            return {
                nameCn: nameCn.trim(),
                nameEn: englishParts.join("|").trim(),
            };
        })
        .filter((outfit) => outfit.nameCn || outfit.nameEn);
}

function renderLine(label: string, value: string): string {
    return value.trim() ? `${label}: ${value.trim()}` : "";
}

function renderSection(label: string, value: string): string {
    return [`## ${label}`, value.trim()].join("\n").trimEnd() + "\n";
}
