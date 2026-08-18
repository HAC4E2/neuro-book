import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";
import {
    buildEffectiveCharacterTriggers,
    normalizeTriggerToken,
} from "nbook/server/text-to-image/character-trigger-words";

export type BodyCharacterMatch = {
    characterId: string;
    groupId: string | null;
    visual: CharacterVisualFile;
    matchedTrigger: string;
    /** 该角色实际命中的全部触发词（规范化前的原始文本形式）。 */
    matchedTriggers: string[];
    /** 注入来源：正文触发扫描或发送数据固定选择。 */
    source: "trigger" | "project-send-data";
};

/** 不同角色被同一个规范化触发词命中时的歧义错误；不得进入 LLM。 */
export class CharacterTriggerAmbiguityError extends Error {
    readonly code = "TEXT_TO_IMAGE_TRIGGER_AMBIGUITY";
    readonly trigger: string;
    readonly characters: Array<{characterId: string; displayName: string}>;

    constructor(trigger: string, characters: Array<{characterId: string; displayName: string}>) {
        super(`触发词“${trigger}”同时命中多个角色：${characters.map((item) => item.displayName || item.characterId).join("、")}；请修改触发词消除歧义`);
        this.name = "CharacterTriggerAmbiguityError";
        this.trigger = trigger;
        this.characters = characters;
    }
}

/**
 * 按 chatu8 的子串命中规则扫描正文：中文按兼容子串命中，英文按 NFKC + 不区分大小写命中。
 * 不同 characterId 被同一个规范化触发词命中时抛出歧义错误；同一角色多个触发词命中只注入一次。
 */
export function scanBodyCharacters(input: {
    chapterContent: string;
    characters: Array<{characterId: string; groupId?: string | null; visual: CharacterVisualFile}>;
}): BodyCharacterMatch[] {
    const normalizedContent = normalizeTriggerToken(input.chapterContent);
    const matches: BodyCharacterMatch[] = [];
    const tokenOwners = new Map<string, string[]>();
    for (const item of input.characters) {
        const triggers = buildEffectiveCharacterTriggers(item.visual.character);
        const matchedTriggers = triggers.filter((word) => normalizedContent.includes(normalizeTriggerToken(word)));
        if (matchedTriggers.length === 0) continue;
        for (const word of matchedTriggers) {
            const key = normalizeTriggerToken(word);
            const owners = tokenOwners.get(key) ?? [];
            if (!owners.includes(item.characterId)) owners.push(item.characterId);
            tokenOwners.set(key, owners);
        }
        matches.push({
            characterId: item.characterId,
            groupId: item.groupId ?? null,
            visual: item.visual,
            matchedTrigger: selectMatchedTrigger(normalizedContent, matchedTriggers),
            matchedTriggers,
            source: "trigger",
        });
    }
    const visuals = new Map(input.characters.map((item) => [item.characterId, item.visual]));
    for (const [token, owners] of tokenOwners) {
        if (owners.length <= 1) continue;
        throw new CharacterTriggerAmbiguityError(token, owners.map((characterId) => {
            const visual = visuals.get(characterId);
            return {
                characterId,
                displayName: visual?.character.cnName.trim() || visual?.character.enName.trim() || characterId,
            };
        }));
    }
    return matches;
}

/** 匹配触发词选择：正文中最早出现者；位置相同取更长触发词；再按配置顺序稳定选择。 */
function selectMatchedTrigger(normalizedContent: string, triggers: string[]): string {
    let best = triggers[0]!;
    let bestIndex = normalizedContent.indexOf(normalizeTriggerToken(best));
    for (let index = 1; index < triggers.length; index += 1) {
        const trigger = triggers[index]!;
        const position = normalizedContent.indexOf(normalizeTriggerToken(trigger));
        if (position === -1) continue;
        if (bestIndex === -1 || position < bestIndex || (position === bestIndex && trigger.length > best.length)) {
            best = trigger;
            bestIndex = position;
        }
    }
    return best;
}

/** 从 Project 的 `.nbook/text-to-image` 视觉库读取角色并扫描正文。 */
export async function scanBodyCharactersFromProject(input: {
    projectRoot: string;
    chapterContent: string;
    characterIds?: string[];
    groupId?: string;
}): Promise<BodyCharacterMatch[]> {
    const library = new CharacterVisualLibraryService();
    if (input.characterIds) {
        const characters: Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}> = [];
        const effective = input.groupId ? null : await library.getEffectiveVisuals(input.projectRoot);
        for (const characterId of input.characterIds) {
            if (input.groupId) {
                const visual = await library.read(input.projectRoot, {groupId: input.groupId, characterId});
                if (visual !== null) characters.push({characterId, groupId: input.groupId, visual});
                continue;
            }
            const item = effective?.find((candidate) => candidate.characterId === characterId);
            if (item) {
                characters.push({characterId, groupId: item.groupId, visual: item.visual});
            }
        }
        return scanBodyCharacters({
            chapterContent: input.chapterContent,
            characters,
        });
    }

    const characters: Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}> = [];
    if (input.groupId) {
        for (const character of await library.listCharacters(input.projectRoot, input.groupId)) {
            const active = character.files.find((file) => file.active) ?? character.files[0];
            if (!active) continue;
            const visual = await library.read(input.projectRoot, {
                groupId: input.groupId,
                characterId: character.characterId,
                visualId: active.visualId,
            });
            if (visual !== null) characters.push({characterId: character.characterId, groupId: input.groupId, visual});
        }
    } else {
        for (const item of await library.getEffectiveVisuals(input.projectRoot)) {
            characters.push({characterId: item.characterId, groupId: item.groupId, visual: item.visual});
        }
    }

    return scanBodyCharacters({
        chapterContent: input.chapterContent,
        characters,
    });
}

/** 组装发往 LLM 的角色/服装摘要；无命中时返回空字符串。 */
export function buildBodyCharacterSummary(matches: BodyCharacterMatch[]): string {
    if (matches.length === 0) {
        return "";
    }
    const sections = matches.map((match) => renderCharacterSection(match.visual));
    const outfits = matches.flatMap((match) => match.visual.outfits);
    if (outfits.length > 0) {
        sections.push(renderOutfitSection(outfits));
    }
    return sections.join("\n\n");
}

/** 独立服装列表的占位符展开，关联字段只产生于当次选择。 */
export function buildBodyOutfitSummary(outfits: CharacterVisualFile["outfits"]): string {
    return outfits.length > 0 ? renderOutfitSection(outfits) : "";
}

function renderCharacterSection(visual: CharacterVisualFile): string {
    const character = visual.character;
    return [
        "<人物>",
        `中文名：${character.cnName}`,
        `英文名：${character.enName}`,
        `角色特征：${character.profileTraits}`,
        `五官正面：${character.facialAppearance}`,
        `五官背面：${character.facialBack}`,
        `上半身 SFW 正面：${character.upperSfw}`,
        `上半身 SFW 背面：${character.upperBackSfw}`,
        `下半身 SFW 正面：${character.lowerSfw}`,
        `下半身 SFW 背面：${character.lowerBackSfw}`,
        `上半身 NSFW 正面：${character.upperNsfw}`,
        `上半身 NSFW 背面：${character.upperBackNsfw}`,
        `下半身 NSFW 正面：${character.lowerNsfw}`,
        `下半身 NSFW 背面：${character.lowerBackNsfw}`,
        `负面提示：${character.negativePrompt}`,
        "</人物>",
    ].join("\n");
}

function renderOutfitSection(outfits: CharacterVisualFile["outfits"]): string {
    return [
        "<服装列表>",
        ...outfits.map((outfit) => [
            "<服装>",
            `服装名：${outfit.cnName}`,
            `英文名：${outfit.enName}`,
            `上半身正面：${outfit.upper}`,
            `上半身背面：${outfit.upperBack}`,
            `下半身正面：${outfit.lower}`,
            `下半身背面：${outfit.lowerBack}`,
            "</服装>",
        ].join("\n")),
        "</服装列表>",
    ].join("\n");
}
