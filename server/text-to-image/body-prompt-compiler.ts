import fs from "node:fs/promises";
import path from "node:path";
import {
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualField, CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const BODY_PROMPT_CODE_PATTERN = /\$\{([\s\S]*?)\}\$/gu;

type BodyPromptCode = {
    name: string;
    characterId: string | null;
    angle: "front" | "back";
    upperBody: "nsfw" | "sfw" | "hidden";
    lowerBody: "nsfw" | "sfw" | "hidden";
};

export type CompiledBodyPrompt = {
    prompt: string;
    negativePrompt: string;
};

/**
 * 队列生成前展开正文占位符里的 `${...}$` 角色/服装调用代码。
 * 角色来源为 `lorebook/character/<id>/visual.json`；找不到时抛错，避免把 JSON 原文发给 NovelAI。
 */
export async function compileBodyPrompt(
    projectRoot: string,
    prompt: string,
): Promise<CompiledBodyPrompt> {
    const negativeParts: string[] = [];
    let output = "";
    let cursor = 0;

    for (const match of prompt.matchAll(BODY_PROMPT_CODE_PATTERN)) {
        const index = match.index ?? 0;
        output += prompt.slice(cursor, index);
        const code = parseBodyPromptCode(match[1] ?? "");
        const visual = await resolveCharacterVisual(projectRoot, code);
        const tags = buildCharacterTags(visual.character, code);
        if (visual.character.negativePrompt.trim() !== "") {
            negativeParts.push(visual.character.negativePrompt.trim());
        }
        output += tags.join(", ");
        cursor = index + match[0].length;
    }
    output += prompt.slice(cursor);

    return {
        prompt: output,
        negativePrompt: negativeParts.join(", "),
    };
}

function parseBodyPromptCode(raw: string): BodyPromptCode {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`角色调用代码不是合法 JSON：${raw}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`角色调用代码必须是 JSON 对象：${raw}`);
    }
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name === "") {
        throw new Error(`角色调用代码缺少 name：${raw}`);
    }
    return {
        name,
        characterId: typeof record.characterId === "string" && record.characterId.trim() !== ""
            ? record.characterId.trim()
            : null,
        angle: record.angle === "back" ? "back" : "front",
        upperBody: record.upperBody === "nsfw" || record.upperBody === "hidden" ? record.upperBody : "sfw",
        lowerBody: record.lowerBody === "nsfw" || record.lowerBody === "hidden" ? record.lowerBody : "sfw",
    };
}

async function resolveCharacterVisual(projectRoot: string, code: BodyPromptCode): Promise<CharacterVisualFile> {
    const characterId = code.characterId ?? await findCharacterIdByName(projectRoot, code.name);
    if (characterId === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    const visual = await readCharacterVisual(projectRoot, characterId);
    if (visual === null) {
        throw new Error(`未找到角色“${code.name}”的 visual.json`);
    }
    return visual;
}

async function findCharacterIdByName(projectRoot: string, name: string): Promise<string | null> {
    const characterRoot = path.join(projectRoot, "lorebook", "character");
    let entries;
    try {
        entries = await fs.readdir(characterRoot, {withFileTypes: true});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const visual = await readCharacterVisual(projectRoot, entry.name).catch(() => null);
        if (visual !== null && (visual.character.cnName === name || visual.character.enName === name)) {
            return entry.name;
        }
    }
    return null;
}

function buildCharacterTags(character: CharacterVisualField, code: BodyPromptCode): string[] {
    const tags = [
        character.enName || character.cnName,
        character.profileTraits,
        code.angle === "back" ? character.facialBack : character.facialAppearance,
    ].filter((tag) => tag.trim() !== "");

    if (code.upperBody !== "hidden") {
        const upper = code.angle === "back"
            ? (code.upperBody === "nsfw" ? character.upperBackNsfw : character.upperBackSfw)
            : (code.upperBody === "nsfw" ? character.upperNsfw : character.upperSfw);
        if (upper.trim() !== "") tags.push(upper);
    }
    if (code.lowerBody !== "hidden") {
        const lower = code.angle === "back"
            ? (code.lowerBody === "nsfw" ? character.lowerBackNsfw : character.lowerBackSfw)
            : (code.lowerBody === "nsfw" ? character.lowerNsfw : character.lowerSfw);
        if (lower.trim() !== "") tags.push(lower);
    }
    return tags;
}
