import {
    listCharacterGroups,
    listCharacterVisualIds,
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

export type BodyCharacterMatch = {
    characterId: string;
    groupId: string | null;
    visual: CharacterVisualFile;
    matchedTrigger: string;
};

/** 拆分并去重逗号分隔的触发词，兼容 chatu8 的 triggerWords 写法。 */
export function splitCharacterTriggerWords(raw: string): string[] {
    return [...new Set(raw.split(",").map((word) => word.trim()).filter((word) => word !== ""))];
}

/** 角色的有效触发词：先取 triggerWords，再回退到英文名与中文名。 */
export function buildCharacterTriggerWords(character: CharacterVisualFile["character"]): string[] {
    return [...new Set([
        ...splitCharacterTriggerWords(character.triggerWords),
        character.enName.trim(),
        character.cnName.trim(),
    ].filter((word) => word !== ""))];
}

/** 按 chatu8 的子串命中规则扫描正文；任一触发词出现即命中。 */
export function scanBodyCharacters(input: {
    chapterContent: string;
    characters: Array<{characterId: string; groupId?: string | null; visual: CharacterVisualFile}>;
}): BodyCharacterMatch[] {
    const matches: BodyCharacterMatch[] = [];
    for (const item of input.characters) {
        const matchedTrigger = buildCharacterTriggerWords(item.visual.character)
            .find((word) => input.chapterContent.includes(word));
        if (matchedTrigger !== undefined) {
            matches.push({
                characterId: item.characterId,
                groupId: item.groupId ?? null,
                visual: item.visual,
                matchedTrigger,
            });
        }
    }
    return matches;
}

/** 从 Project 的 `lorebook/character` 读取全部角色并扫描正文。 */
export async function scanBodyCharactersFromProject(input: {
    projectRoot: string;
    chapterContent: string;
    characterIds?: string[];
    groupId?: string;
}): Promise<BodyCharacterMatch[]> {
    if (input.characterIds) {
        const characters = [];
        for (const characterId of input.characterIds) {
            const visual = await readCharacterVisual(input.projectRoot, characterId, input.groupId);
            if (visual !== null) {
                characters.push({characterId, groupId: input.groupId ?? null, visual});
            }
        }
        return scanBodyCharacters({
            chapterContent: input.chapterContent,
            characters,
        });
    }

    const characters: Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}> = [];
    const groupedCharacterIds = new Set<string>();
    if (input.groupId) {
        for (const characterId of await listCharacterVisualIds(input.projectRoot, input.groupId)) {
            const visual = await readCharacterVisual(input.projectRoot, characterId, input.groupId);
            if (visual !== null) {
                characters.push({characterId, groupId: input.groupId, visual});
            }
        }
    } else {
        for (const group of await listCharacterGroups(input.projectRoot)) {
            for (const characterId of await listCharacterVisualIds(input.projectRoot, group.groupId)) {
                const visual = await readCharacterVisual(input.projectRoot, characterId, group.groupId);
                if (visual !== null) {
                    characters.push({characterId, groupId: group.groupId, visual});
                    groupedCharacterIds.add(characterId);
                }
            }
        }

        for (const characterId of await listCharacterVisualIds(input.projectRoot)) {
            if (groupedCharacterIds.has(characterId)) continue;
            const visual = await readCharacterVisual(input.projectRoot, characterId);
            if (visual !== null) {
                characters.push({characterId, groupId: null, visual});
            }
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

/** 鐙珛鏈嶈鍒楄〃鐨勫崰浣嶇灞曞紑锛屽叧鑱斿瓧娈靛彧浜х敓浜庡綋娆￠€夋嫨銆?*/
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
