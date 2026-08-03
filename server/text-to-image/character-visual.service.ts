import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";

const CHARACTER_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const VISUAL_FILE = "visual.json";

/**
 * 读写 Project 内 `lorebook/character/<characterId>/visual.json`。
 * 首版使用原子写盘；Workspace History 记账由后续 P6 接入 tracked write。
 */
export async function readCharacterVisual(projectRoot: string, characterId: string): Promise<CharacterVisualFile | null> {
    const filePath = resolveVisualPath(projectRoot, characterId);
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

/** 原子写入 visual.json。 */
export async function writeCharacterVisual(projectRoot: string, characterId: string, input: CharacterVisualFile): Promise<void> {
    const filePath = resolveVisualPath(projectRoot, characterId);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, renderCharacterVisualJson(input), "utf8");
    await fs.rename(temporaryPath, filePath);
}

function resolveVisualPath(projectRoot: string, characterId: string): string {
    if (!CHARACTER_ID_PATTERN.test(characterId)) {
        throw new Error(`非法 characterId：${characterId}`);
    }
    return path.join(projectRoot, "lorebook", "character", characterId, VISUAL_FILE);
}
