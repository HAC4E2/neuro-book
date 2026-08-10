import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";

const GROUP_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const VISUAL_FILE = "visual.json";
const GROUP_FILE = ".group.json";

export type CharacterGroupInfo = {
    groupId: string;
    name: string;
    description: string;
};

export type CharacterDocumentLocation = {
    characterId: string;
    groupId: string | null;
    relativePath: string;
};

/**
 * 读写 Project 内 `lorebook/character/<groupId>/<characterId>/visual.json`。
 * 不传 groupId 时兼容旧单层路径 `lorebook/character/<characterId>/visual.json`。
 */
export async function readCharacterVisual(
    projectRoot: string,
    characterId: string,
    groupId?: string,
): Promise<CharacterVisualFile | null> {
    assertValidId(characterId, "characterId");
    const characterRoot = characterRootOf(projectRoot);

    if (groupId) {
        assertValidId(groupId, "groupId");
        const grouped = await readVisualFile(path.join(characterRoot, groupId, characterId, VISUAL_FILE));
        if (grouped !== null) {
            return grouped;
        }
        // 旧项目没有分组目录，把旧单层角色视为默认分组的内容。
        if (groupId === "default") {
            return readVisualFile(path.join(characterRoot, characterId, VISUAL_FILE));
        }
        return null;
    }

    const legacy = await readVisualFile(path.join(characterRoot, characterId, VISUAL_FILE));
    if (legacy !== null) {
        return legacy;
    }
    for (const group of await listCharacterGroups(projectRoot)) {
        const grouped = await readVisualFile(path.join(characterRoot, group.groupId, characterId, VISUAL_FILE));
        if (grouped !== null) {
            return grouped;
        }
    }
    return null;
}

/** 原子写入 visual.json；传入 groupId 时写入分组目录。 */
export async function writeCharacterVisual(
    projectRoot: string,
    characterId: string,
    input: CharacterVisualFile,
    groupId?: string,
): Promise<void> {
    assertValidId(characterId, "characterId");
    const characterRoot = characterRootOf(projectRoot);
    const targetDirectory = groupId
        ? path.join(characterRoot, groupId, characterId)
        : path.join(characterRoot, characterId);
    if (groupId) {
        assertValidId(groupId, "groupId");
    }
    await fs.mkdir(targetDirectory, {recursive: true});
    const filePath = path.join(targetDirectory, VISUAL_FILE);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, renderCharacterVisualJson(input), "utf8");
    await fs.rename(temporaryPath, filePath);
}

/** 列出 Project 内的角色分组；旧单层角色目录不会被当作分组。 */
export async function listCharacterGroups(projectRoot: string): Promise<CharacterGroupInfo[]> {
    const characterRoot = characterRootOf(projectRoot);
    const entries = await readDirectories(characterRoot);
    const groups: CharacterGroupInfo[] = [];
    for (const entry of entries) {
        const groupDirectory = path.join(characterRoot, entry.name);
        if (await hasDirectVisualFile(groupDirectory)) {
            continue;
        }
        groups.push(await readCharacterGroupInfo(groupDirectory, entry.name));
    }
    return groups.sort((left, right) => left.groupId.localeCompare(right.groupId));
}

/** 创建角色分组并写入 `.group.json` 标记。 */
export async function createCharacterGroup(
    projectRoot: string,
    groupId: string,
    input?: {name?: string; description?: string},
): Promise<CharacterGroupInfo> {
    assertValidId(groupId, "groupId");
    const groupDirectory = path.join(characterRootOf(projectRoot), groupId);
    await fs.mkdir(groupDirectory, {recursive: true});
    const info = {
        schema: "nbook.character-group/v1",
        groupId,
        name: input?.name?.trim() || groupId,
        description: input?.description?.trim() || "",
    };
    await fs.writeFile(path.join(groupDirectory, GROUP_FILE), `${JSON.stringify(info, null, 2)}\n`, "utf8");
    return {
        groupId,
        name: info.name,
        description: info.description,
    };
}

/** 删除角色视觉目录；default 分组优先删除分组路径，兼容旧单层路径。 */
/** 更新角色分组展示信息；分组 ID 与其下的角色目录保持不变。 */
export async function updateCharacterGroup(
    projectRoot: string,
    groupId: string,
    input: {name?: string; description?: string},
): Promise<CharacterGroupInfo> {
    assertValidId(groupId, "groupId");
    const groupDirectory = path.join(characterRootOf(projectRoot), groupId);
    if (!await pathExists(groupDirectory)) {
        throw new Error(`未找到角色分组“${groupId}”`);
    }
    const current = await readCharacterGroupInfo(groupDirectory, groupId);
    const info = {
        schema: "nbook.character-group/v1",
        groupId,
        name: input.name?.trim() || current.name,
        description: input.description?.trim() ?? current.description,
    };
    await fs.writeFile(path.join(groupDirectory, GROUP_FILE), `${JSON.stringify(info, null, 2)}\n`, "utf8");
    return {
        groupId,
        name: info.name,
        description: info.description,
    };
}

export async function deleteCharacterVisual(
    projectRoot: string,
    characterId: string,
    groupId?: string,
): Promise<void> {
    assertValidId(characterId, "characterId");
    const characterRoot = characterRootOf(projectRoot);
    if (groupId) {
        assertValidId(groupId, "groupId");
        await removeVisualFileAndPhotos(path.join(characterRoot, groupId, characterId, VISUAL_FILE), projectRoot);
        if (groupId === "default") {
            await removeVisualFileAndPhotos(path.join(characterRoot, characterId, VISUAL_FILE), projectRoot);
        }
        return;
    }
    await removeVisualFileAndPhotos(path.join(characterRoot, characterId, VISUAL_FILE), projectRoot);
}

/** 删除角色分组目录。 */
export async function deleteCharacterGroup(
    projectRoot: string,
    groupId: string,
): Promise<void> {
    assertValidId(groupId, "groupId");
    await fs.rm(path.join(characterRootOf(projectRoot), groupId), {recursive: true, force: true});
}

/** 列出角色 ID；传 groupId 时只列该分组（default 额外兼容旧单层角色）。 */
export async function listCharacterVisualIds(
    projectRoot: string,
    groupId?: string,
): Promise<string[]> {
    const characterRoot = characterRootOf(projectRoot);
    if (groupId) {
        assertValidId(groupId, "groupId");
        const grouped = await listCharacterIdsInDirectory(path.join(characterRoot, groupId));
        if (groupId === "default") {
            const legacy = await listCharacterIdsInDirectory(characterRoot);
            return [...new Set([...grouped, ...legacy])].sort();
        }
        return grouped.sort();
    }

    const ids = new Set<string>();
    for (const id of await listCharacterIdsInDirectory(characterRoot)) {
        ids.add(id);
    }
    for (const group of await listCharacterGroups(projectRoot)) {
        for (const id of await listCharacterIdsInDirectory(path.join(characterRoot, group.groupId))) {
            ids.add(id);
        }
    }
    return [...ids].sort();
}

/** 列出未归入分组的旧版单层角色视觉目录。 */
export async function listLegacyCharacterVisualIds(projectRoot: string): Promise<string[]> {
    return listCharacterIdsInDirectory(characterRootOf(projectRoot));
}

/** 列出 Project 角色原始 Markdown；视觉资料删除后仍用它保留角色入口。 */
export async function listCharacterDocumentLocations(projectRoot: string): Promise<CharacterDocumentLocation[]> {
    const characterRoot = characterRootOf(projectRoot);
    const result: CharacterDocumentLocation[] = [];
    for (const entry of await readDirectories(characterRoot)) {
        if (await pathExists(path.join(entry.path, "index.md"))) {
            result.push({
                characterId: entry.name,
                groupId: null,
                relativePath: `lorebook/character/${entry.name}/index.md`,
            });
            continue;
        }
        for (const character of await readDirectories(entry.path)) {
            if (!await pathExists(path.join(character.path, "index.md"))) continue;
            result.push({
                characterId: character.name,
                groupId: entry.name,
                relativePath: `lorebook/character/${entry.name}/${character.name}/index.md`,
            });
        }
    }
    return result.sort((left, right) => (
        `${left.groupId ?? ""}/${left.characterId}`.localeCompare(`${right.groupId ?? ""}/${right.characterId}`)
    ));
}

function characterRootOf(projectRoot: string): string {
    return path.join(projectRoot, "lorebook", "character");
}

function assertValidId(value: string, label: string): void {
    const pattern = label === "groupId" ? GROUP_ID_PATTERN : CHARACTER_ID_PATTERN;
    if (!pattern.test(value)) {
        throw new Error(`非法 ${label}：${value}`);
    }
}

async function readVisualFile(filePath: string): Promise<CharacterVisualFile | null> {
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function readDirectories(directory: string): Promise<Array<{name: string; path: string}>> {
    let entries;
    try {
        entries = await fs.readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({name: entry.name, path: path.join(directory, entry.name)}));
}

async function listCharacterIdsInDirectory(directory: string): Promise<string[]> {
    const directories = await readDirectories(directory);
    const ids: string[] = [];
    for (const item of directories) {
        if (await pathExists(path.join(item.path, VISUAL_FILE))) {
            ids.push(item.name);
        }
    }
    return ids;
}

async function hasDirectVisualFile(directory: string): Promise<boolean> {
    return pathExists(path.join(directory, VISUAL_FILE));
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function removeVisualFile(filePath: string): Promise<void> {
    await fs.rm(filePath, {force: true});
}

async function removeVisualFileAndPhotos(filePath: string, projectRoot: string): Promise<void> {
    const visual = await readVisualFile(filePath);
    await removeVisualFile(filePath);
    if (!visual) return;
    await Promise.all(visual.photos
        .filter((relativePath) => relativePath.startsWith("assets/tti/"))
        .map(async (relativePath) => {
            await fs.rm(resolveTextToImageAssetPath(projectRoot, relativePath), {force: true});
        }));
}

async function readCharacterGroupInfo(groupDirectory: string, groupId: string): Promise<CharacterGroupInfo> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(groupDirectory, GROUP_FILE), "utf8")) as {
            name?: unknown;
            description?: unknown;
        };
        return {
            groupId,
            name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : groupId,
            description: typeof raw.description === "string" ? raw.description : "",
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {groupId, name: groupId, description: ""};
        }
        throw error;
    }
}
