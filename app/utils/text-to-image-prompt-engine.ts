export type TextToImagePromptRuleTarget = "positive" | "negative";
export type TextToImagePromptRuleMatchMode = "plain" | "regex";
export type TextToImagePromptRuleMode = "replace" | "append" | "prepend" | "delete";

export type TextToImagePromptReplacementRule = {
    id: string;
    name: string;
    enabled: boolean;
    target: TextToImagePromptRuleTarget;
    matchMode: TextToImagePromptRuleMatchMode;
    mode: TextToImagePromptRuleMode;
    trigger: string;
    replacement: string;
};

export type TextToImagePromptEngineCharacter = {
    id: string;
    cnName: string;
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
    negativePrompt?: string;
};

export type TextToImagePromptEngineOutfit = {
    id: string;
    nameCn: string;
    nameEn: string;
    aliases: string;
    enabled: boolean;
    upperFront: string;
    upperBack: string;
    lowerFront: string;
    lowerBack: string;
    fullPrompt?: string;
    negativePrompt?: string;
};

export type TextToImageResolvedCharacterPrompt = {
    characterId: string;
    name: string;
    prompt: string;
    negativePrompt: string;
    center: {x: number; y: number};
};

export type TextToImageResolvedPrompt = {
    prompt: string;
    negativePrompt: string;
    characterPrompts: TextToImageResolvedCharacterPrompt[];
    appliedRules: TextToImagePromptReplacementRule[];
    unresolvedTriggers: string[];
};

type BodyMode = "hidden" | "sfw" | "nsfw";
type TriggerKind = "character" | "outfit";

type ParsedTrigger = {
    rawName: string;
    normalizedName: string;
    kindHint: TriggerKind | "";
    backView: boolean;
    upperBody: BodyMode;
    lowerBody: BodyMode;
};

const TRIGGER_PATTERN = /\$([^$]+)\$/gu;

const TRIGGER_SUFFIXES: Array<{suffix: string; upperBody: BodyMode; lowerBody: BodyMode; kindHint: TriggerKind | ""}> = [
    {suffix: "-sfw-upperbody-nsfw-lowerbody", upperBody: "sfw", lowerBody: "nsfw", kindHint: "character"},
    {suffix: "-nsfw-upperbody-sfw-lowerbody", upperBody: "nsfw", lowerBody: "sfw", kindHint: "character"},
    {suffix: "-sfw-upperbody-sfw-lowerbody", upperBody: "sfw", lowerBody: "sfw", kindHint: "character"},
    {suffix: "-nsfw-upperbody-nsfw-lowerbody", upperBody: "nsfw", lowerBody: "nsfw", kindHint: "character"},
    {suffix: "-sfw-fullbody", upperBody: "sfw", lowerBody: "sfw", kindHint: ""},
    {suffix: "-nsfw-fullbody", upperBody: "nsfw", lowerBody: "nsfw", kindHint: "character"},
    {suffix: "-fullbody", upperBody: "sfw", lowerBody: "sfw", kindHint: "outfit"},
    {suffix: "-sfw-upperbody", upperBody: "sfw", lowerBody: "hidden", kindHint: "character"},
    {suffix: "-nsfw-upperbody", upperBody: "nsfw", lowerBody: "hidden", kindHint: "character"},
    {suffix: "-upperbody", upperBody: "sfw", lowerBody: "hidden", kindHint: "outfit"},
    {suffix: "-sfw-lowerbody", upperBody: "hidden", lowerBody: "sfw", kindHint: "character"},
    {suffix: "-nsfw-lowerbody", upperBody: "hidden", lowerBody: "nsfw", kindHint: "character"},
    {suffix: "-lowerbody", upperBody: "hidden", lowerBody: "sfw", kindHint: "outfit"},
];

export function resolveTextToImagePrompt(options: {
    prompt: string;
    negativePrompt?: string;
    characters?: TextToImagePromptEngineCharacter[];
    outfits?: TextToImagePromptEngineOutfit[];
    promptRules?: TextToImagePromptReplacementRule[];
    activeCharacter?: TextToImagePromptEngineCharacter | null;
}): TextToImageResolvedPrompt {
    const characters = options.characters ?? [];
    const outfits = (options.outfits ?? []).filter((outfit) => outfit.enabled !== false);
    const characterPrompts: TextToImageResolvedCharacterPrompt[] = [];
    const unresolvedTriggers: string[] = [];
    let negativePrompt = options.negativePrompt ?? "";

    let prompt = options.prompt.replace(TRIGGER_PATTERN, (raw, inner: string) => {
        const parsed = parsePromptTrigger(inner.trim());
        const character = parsed.kindHint !== "outfit" ? findBestCharacter(parsed.normalizedName, characters) : null;
        if (character) {
            const built = buildCharacterPrompt(character, parsed);
            if (built.negativePrompt) {
                negativePrompt = mergeTagText(negativePrompt, built.negativePrompt);
            }
            characterPrompts.push({
                characterId: character.id,
                name: character.cnName.trim() || character.enName.trim() || parsed.rawName,
                prompt: built.prompt,
                negativePrompt: built.negativePrompt,
                center: nextCharacterCenter(characterPrompts.length),
            });
            return built.prompt;
        }

        const outfit = parsed.kindHint !== "character" ? findBestOutfit(parsed.normalizedName, outfits) : null;
        if (outfit) {
            const built = buildOutfitPrompt(outfit, parsed);
            if (built.negativePrompt) {
                negativePrompt = mergeTagText(negativePrompt, built.negativePrompt);
            }
            return built.prompt;
        }

        unresolvedTriggers.push(inner.trim());
        return raw;
    });

    if (options.activeCharacter && characterPrompts.length === 0 && !promptIncludesCharacter(options.activeCharacter, prompt)) {
        const parsed: ParsedTrigger = {
            rawName: options.activeCharacter.cnName || options.activeCharacter.enName,
            normalizedName: normalizePromptName(options.activeCharacter.cnName || options.activeCharacter.enName),
            kindHint: "character",
            backView: false,
            upperBody: "sfw",
            lowerBody: "sfw",
        };
        const built = buildCharacterPrompt(options.activeCharacter, parsed);
        if (built.prompt) {
            prompt = mergeTagText(built.prompt, prompt);
            characterPrompts.push({
                characterId: options.activeCharacter.id,
                name: options.activeCharacter.cnName.trim() || options.activeCharacter.enName.trim(),
                prompt: built.prompt,
                negativePrompt: built.negativePrompt,
                center: nextCharacterCenter(0),
            });
        }
    }

    const ruleResult = applyPromptReplacementRules({
        prompt,
        negativePrompt,
        promptRules: options.promptRules ?? [],
    });

    return {
        prompt: dedupeTextToImageTags(ruleResult.prompt),
        negativePrompt: dedupeTextToImageTags(ruleResult.negativePrompt),
        characterPrompts: characterPrompts.map((item) => ({
            ...item,
            prompt: dedupeTextToImageTags(item.prompt),
            negativePrompt: dedupeTextToImageTags(item.negativePrompt),
        })),
        appliedRules: ruleResult.appliedRules,
        unresolvedTriggers,
    };
}

export function applyPromptReplacementRules(options: {
    prompt: string;
    negativePrompt: string;
    promptRules: TextToImagePromptReplacementRule[];
}): {prompt: string; negativePrompt: string; appliedRules: TextToImagePromptReplacementRule[]} {
    let prompt = options.prompt;
    let negativePrompt = options.negativePrompt;
    const appliedRules: TextToImagePromptReplacementRule[] = [];

    for (const rule of options.promptRules) {
        if (!rule.enabled) {
            continue;
        }
        const current = rule.target === "negative" ? negativePrompt : prompt;
        const next = applySinglePromptRule(current, rule);
        if (next === current && rule.mode !== "append" && rule.mode !== "prepend") {
            continue;
        }
        if (rule.target === "negative") {
            negativePrompt = next;
        } else {
            prompt = next;
        }
        appliedRules.push(rule);
    }

    return {prompt, negativePrompt, appliedRules};
}

export function dedupeTextToImageTags(value: string): string {
    const seen = new Set<string>();
    const tags = splitTagText(value)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .filter((tag) => {
            const key = tag.toLocaleLowerCase();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    return tags.join(", ");
}

export function mergeTagText(...parts: Array<string | null | undefined>): string {
    return parts
        .flatMap((part) => splitTagText(part ?? ""))
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ");
}

function applySinglePromptRule(content: string, rule: TextToImagePromptReplacementRule): string {
    const replacement = rule.replacement.trim();
    if (rule.mode === "append") {
        return mergeTagText(content, replacement);
    }
    if (rule.mode === "prepend") {
        return mergeTagText(replacement, content);
    }

    const trigger = rule.trigger.trim();
    if (!trigger) {
        return content;
    }
    const pattern = rule.matchMode === "regex" ? safeRegExp(trigger) : null;
    if (rule.matchMode === "regex" && !pattern) {
        return content;
    }
    if (rule.mode === "delete") {
        return pattern ? content.replace(pattern, "") : content.split(trigger).join("");
    }
    return pattern ? content.replace(pattern, replacement) : content.split(trigger).join(replacement);
}

function safeRegExp(source: string): RegExp | null {
    try {
        return new RegExp(source, "giu");
    } catch {
        return null;
    }
}

function parsePromptTrigger(segment: string): ParsedTrigger {
    const json = parseTriggerJson(segment);
    if (json) {
        return json;
    }

    let name = segment;
    let upperBody: BodyMode = "sfw";
    let lowerBody: BodyMode = "sfw";
    let kindHint: TriggerKind | "" = "";
    const lowerSegment = segment.toLocaleLowerCase();
    for (const item of TRIGGER_SUFFIXES) {
        if (lowerSegment.endsWith(item.suffix)) {
            name = segment.slice(0, -item.suffix.length).trim();
            upperBody = item.upperBody;
            lowerBody = item.lowerBody;
            kindHint = item.kindHint;
            break;
        }
    }
    const backView = /(?:from\s+behind|back\s+view|behind|背面|后背|背后)/iu.test(name);
    return {
        rawName: name,
        normalizedName: normalizePromptName(name.replace(/(?:from\s+behind|back\s+view|背面|后背|背后)/giu, "")),
        kindHint,
        backView,
        upperBody,
        lowerBody,
    };
}

function parseTriggerJson(segment: string): ParsedTrigger | null {
    if (!segment.startsWith("{") || !segment.endsWith("}")) {
        return null;
    }
    try {
        const data = JSON.parse(segment) as Record<string, unknown>;
        const name = readString(data, ["name", "角色", "角色名", "character", "characterName"]);
        if (!name) {
            return null;
        }
        const angle = readString(data, ["angle", "view", "视角"]);
        return {
            rawName: name,
            normalizedName: normalizePromptName(name),
            kindHint: readString(data, ["type", "kind"]) === "outfit" ? "outfit" : "character",
            backView: /(?:from\s+behind|back|behind|背面|后背|背后)/iu.test(angle),
            upperBody: normalizeBodyMode(readString(data, ["upperBody", "upper", "上半身"]), "hidden"),
            lowerBody: normalizeBodyMode(readString(data, ["lowerBody", "lower", "下半身"]), "hidden"),
        };
    } catch {
        return null;
    }
}

function normalizeBodyMode(value: string, fallback: BodyMode): BodyMode {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized.includes("nsfw")) {
        return "nsfw";
    }
    if (normalized.includes("sfw")) {
        return "sfw";
    }
    if (normalized.includes("hidden") || normalized.includes("none") || normalized.includes("不")) {
        return "hidden";
    }
    return fallback;
}

function findBestCharacter(name: string, characters: TextToImagePromptEngineCharacter[]): TextToImagePromptEngineCharacter | null {
    return bestMatch(name, characters, (character) => [
        character.cnName,
        character.enName,
    ]);
}

function findBestOutfit(name: string, outfits: TextToImagePromptEngineOutfit[]): TextToImagePromptEngineOutfit | null {
    return bestMatch(name, outfits, (outfit) => [
        outfit.nameCn,
        outfit.nameEn,
        outfit.aliases,
    ]);
}

function bestMatch<T>(name: string, items: T[], readNames: (item: T) => string[]): T | null {
    if (!name) {
        return null;
    }
    let best: {item: T; score: number} | null = null;
    for (const item of items) {
        for (const alias of readNames(item).flatMap(splitAliases)) {
            const normalizedAlias = normalizePromptName(alias);
            if (!normalizedAlias) {
                continue;
            }
            const score = normalizedAlias === name
                ? 100
                : normalizedAlias.includes(name) || name.includes(normalizedAlias)
                    ? Math.min(normalizedAlias.length, name.length)
                    : 0;
            if (score > (best?.score ?? 0)) {
                best = {item, score};
            }
        }
    }
    return best?.item ?? null;
}

function buildCharacterPrompt(character: TextToImagePromptEngineCharacter, trigger: ParsedTrigger): {prompt: string; negativePrompt: string} {
    const face = trigger.backView ? character.facialBack : character.facialAppearance;
    const upper = trigger.upperBody === "sfw"
        ? trigger.backView ? character.upperBackSfw : character.upperSfw
        : trigger.upperBody === "nsfw"
            ? trigger.backView ? character.upperBackNsfw : character.upperNsfw
            : "";
    const lower = trigger.lowerBody === "sfw"
        ? trigger.backView ? character.lowerBackSfw : character.lowerSfw
        : trigger.lowerBody === "nsfw"
            ? trigger.backView ? character.lowerBackNsfw : character.lowerNsfw
            : "";
    return {
        prompt: mergeTagText(character.enName.split("|")[0], character.profileTraits, face, upper, lower),
        negativePrompt: character.negativePrompt ?? "",
    };
}

function buildOutfitPrompt(outfit: TextToImagePromptEngineOutfit, trigger: ParsedTrigger): {prompt: string; negativePrompt: string} {
    const upper = trigger.upperBody === "hidden" ? "" : trigger.backView ? outfit.upperBack : outfit.upperFront;
    const lower = trigger.lowerBody === "hidden" ? "" : trigger.backView ? outfit.lowerBack : outfit.lowerFront;
    return {
        prompt: mergeTagText(outfit.fullPrompt, upper, lower),
        negativePrompt: outfit.negativePrompt ?? "",
    };
}

function nextCharacterCenter(index: number): {x: number; y: number} {
    const centers = [
        {x: 0.5, y: 0.5},
        {x: 0.32, y: 0.5},
        {x: 0.68, y: 0.5},
        {x: 0.18, y: 0.5},
        {x: 0.82, y: 0.5},
    ];
    return centers[index] ?? centers[0]!;
}

function promptIncludesCharacter(character: TextToImagePromptEngineCharacter, prompt: string): boolean {
    const promptKey = normalizePromptName(prompt);
    return splitAliases(character.cnName)
        .concat(splitAliases(character.enName))
        .some((name) => {
            const normalized = normalizePromptName(name);
            return Boolean(normalized && promptKey.includes(normalized));
        });
}

function splitAliases(value: string): string[] {
    return value.split(/[|｜,，;；\n]/u).map((item) => item.trim()).filter(Boolean);
}

function splitTagText(value: string): string[] {
    return value.split(/[,，]/u);
}

function normalizePromptName(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase()
        .replace(/\$|["'`]/gu, "")
        .replace(/[\s_\-:/：｜|（）()【】\[\]{}]+/gu, "");
}

function readString(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}
