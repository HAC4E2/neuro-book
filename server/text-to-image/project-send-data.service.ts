import fs from "node:fs/promises";
import path from "node:path";
import {
    TextToImageProjectSendDataSchema,
    type TextToImageProjectOutfitSelection,
    type TextToImageProjectSendData,
} from "nbook/shared/dto/text-to-image.dto";
import {
    listCharacterGroups,
    listLegacyCharacterVisualIds,
    listCharacterVisualIds,
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualFile, OutfitVisual} from "nbook/server/text-to-image/character-visual.codec";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";

const SEND_DATA_FILE = path.join(".nbook", "text-to-image-send-data.json");
const LOREBOOK_ENTRY_PATTERN = /^lorebook\/(?!character(?:\/|$))[^/]+(?:\/[^/]+)*\/index\.md$/u;

export type ProjectSendDataOptions = {
    lorebookEntries: Array<{path: string; title: string}>;
    characters: Array<{
        characterId: string;
        groupId: string | null;
        cnName: string;
        enName: string;
        outfits: Array<{name: string; cnName: string; enName: string}>;
    }>;
};

export type ProjectSendDataSnapshot = {
    lorebookEntries: Array<{path: string; content: string}>;
    characters: Array<{characterId: string; groupId: string | null; visual: CharacterVisualFile}>;
    outfits: Array<{characterId: string; outfit: OutfitVisual}>;
    missingItems: string[];
};

export async function readProjectSendData(projectRoot: string): Promise<TextToImageProjectSendData> {
    try {
        const content = await fs.readFile(path.join(projectRoot, SEND_DATA_FILE), "utf8");
        return normalizeProjectSendData(JSON.parse(content) as unknown);
    } catch (error) {
        if (isFileNotFound(error)) {
            return emptyProjectSendData();
        }
        throw error;
    }
}

export async function writeProjectSendData(
    projectRoot: string,
    input: TextToImageProjectSendData,
): Promise<TextToImageProjectSendData> {
    const data = normalizeProjectSendData(input);
    const directory = path.join(projectRoot, ".nbook");
    await fs.mkdir(directory, {recursive: true});
    const filePath = path.join(projectRoot, SEND_DATA_FILE);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
    return data;
}

export async function listProjectSendDataOptions(projectRoot: string): Promise<ProjectSendDataOptions> {
    const lorebookEntries = await listLorebookEntries(projectRoot);
    const characters: ProjectSendDataOptions["characters"] = [];
    const locations = new Map<string, string | null>();
    for (const group of await listCharacterGroups(projectRoot)) {
        for (const characterId of await listCharacterVisualIds(projectRoot, group.groupId)) {
            locations.set(`${group.groupId}\u0000${characterId}`, group.groupId);
        }
    }
    for (const characterId of await listLegacyCharacterVisualIds(projectRoot)) {
        if (locations.has(`default\u0000${characterId}`)) continue;
        locations.set(`legacy\u0000${characterId}`, null);
    }
    for (const [key, groupId] of locations) {
        const characterId = key.split("\u0000").at(-1) ?? "";
        const visual = await readCharacterVisual(projectRoot, characterId, groupId ?? undefined);
        if (visual === null) continue;
        characters.push({
            characterId,
            groupId,
            cnName: visual.character.cnName,
            enName: visual.character.enName,
            outfits: visual.outfits.map((outfit) => ({
                name: outfit.cnName || outfit.enName,
                cnName: outfit.cnName,
                enName: outfit.enName,
            })).filter((outfit) => outfit.name !== ""),
        });
    }
    characters.sort((left, right) => `${left.groupId ?? ""}/${left.characterId}`.localeCompare(`${right.groupId ?? ""}/${right.characterId}`));
    return {
        lorebookEntries,
        characters,
    };
}

export async function readProjectSendDataSnapshot(
    projectRoot: string,
    input: TextToImageProjectSendData,
): Promise<ProjectSendDataSnapshot> {
    const data = normalizeProjectSendData(input);
    const lorebookEntries: ProjectSendDataSnapshot["lorebookEntries"] = [];
    const missingItems: string[] = [];
    for (const relativePath of data.lorebookPaths) {
        try {
            lorebookEntries.push({
                path: relativePath,
                content: await readWorkspaceTextFile(absoluteFsPath(projectRoot), relativePath),
            });
        } catch (error) {
            if (!isFileNotFound(error)) throw error;
            missingItems.push(relativePath);
        }
    }

    const visualCache = new Map<string, CharacterVisualFile | null>();
    const readVisual = async (characterId: string, groupId: string | null = null): Promise<CharacterVisualFile | null> => {
        const key = `${groupId ?? ""}\u0000${characterId}`;
        if (!visualCache.has(key)) {
            visualCache.set(key, await readCharacterVisual(projectRoot, characterId, groupId ?? undefined));
        }
        return visualCache.get(key) ?? null;
    };

    const characters: ProjectSendDataSnapshot["characters"] = [];
    for (const selection of data.characterSelections) {
        const visual = await readCharacterVisual(projectRoot, selection.characterId, selection.groupId ?? undefined);
        if (visual !== null) {
            characters.push({characterId: selection.characterId, groupId: selection.groupId, visual});
        } else {
            missingItems.push(`character:${selection.groupId ?? "legacy"}/${selection.characterId}`);
        }
    }

    const outfits: ProjectSendDataSnapshot["outfits"] = [];
    for (const selection of data.outfitSelections) {
        const visual = await readVisual(selection.characterId, selection.groupId ?? null);
        const outfit = visual?.outfits.find((candidate) => matchesOutfit(candidate, selection.name));
        if (outfit) {
            outfits.push({characterId: selection.characterId, outfit});
        } else {
            missingItems.push(`outfit:${selection.characterId}/${selection.name}`);
        }
    }

    return {lorebookEntries, characters, outfits, missingItems};
}

function normalizeProjectSendData(input: unknown): TextToImageProjectSendData {
    const parsed = TextToImageProjectSendDataSchema.parse(input);
    const lorebookPaths = [...new Set(parsed.lorebookPaths.map(normalizeLorebookPath))];
    for (const relativePath of lorebookPaths) {
        if (!LOREBOOK_ENTRY_PATTERN.test(relativePath)) {
            throw new Error(`非法 Lorebook 条目路径：${relativePath}`);
        }
    }
    const characterSelections = uniqueCharacterSelections([
        ...parsed.characterSelections,
        ...parsed.characterIds.map((characterId) => ({characterId, groupId: null})),
    ]);
    const characterIds = [...new Set(characterSelections.map((selection) => selection.characterId))];
    const outfitSelections = uniqueOutfitSelections(parsed.outfitSelections);
    return {lorebookPaths, characterIds, characterSelections, outfitSelections};
}

function normalizeLorebookPath(value: string): string {
    return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function uniqueOutfitSelections(input: TextToImageProjectOutfitSelection[]): TextToImageProjectOutfitSelection[] {
    const seen = new Set<string>();
    return input.map((selection) => ({...selection, groupId: selection.groupId ?? null})).filter((selection) => {
        const key = `${selection.groupId}\u0000${selection.characterId}\u0000${selection.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueCharacterSelections(input: TextToImageProjectSendData["characterSelections"]): TextToImageProjectSendData["characterSelections"] {
    const seen = new Set<string>();
    return input.filter((selection) => {
        const key = `${selection.groupId ?? ""}\u0000${selection.characterId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function emptyProjectSendData(): TextToImageProjectSendData {
    return {lorebookPaths: [], characterIds: [], characterSelections: [], outfitSelections: []};
}

async function listLorebookEntries(projectRoot: string): Promise<ProjectSendDataOptions["lorebookEntries"]> {
    const result: ProjectSendDataOptions["lorebookEntries"] = [];
    await walk(path.join(projectRoot, "lorebook"), "lorebook", result);
    return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(
    directory: string,
    relativeDirectory: string,
    result: ProjectSendDataOptions["lorebookEntries"],
): Promise<void> {
    let entries;
    try {
        entries = await fs.readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (isFileNotFound(error)) return;
        throw error;
    }
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const absolutePath = path.join(directory, entry.name);
        const relativePath = `${relativeDirectory}/${entry.name}`;
        if (entry.isDirectory()) {
            if (relativePath === "lorebook/character") continue;
            await walk(absolutePath, relativePath, result);
            continue;
        }
        if (entry.name !== "index.md" || !LOREBOOK_ENTRY_PATTERN.test(relativePath)) continue;
        const content = await fs.readFile(absolutePath, "utf8");
        result.push({path: relativePath, title: deriveTitle(content, path.basename(path.dirname(relativePath)))});
    }
}

function deriveTitle(content: string, fallback: string): string {
    const heading = content.match(/^#{1,6}\s+(.+?)\s*#*\s*$/mu)?.[1]?.trim();
    if (heading) return heading;
    return fallback;
}

function matchesOutfit(outfit: OutfitVisual, name: string): boolean {
    return outfit.cnName === name || outfit.enName === name;
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
