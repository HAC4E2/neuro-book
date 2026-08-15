import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";

const LIBRARY_DIRECTORY = path.join(".nbook", "text-to-image");
const GROUPS_FILE = "character-groups.json";
const GROUP_DIRECTORY = "character-groups";
const MANIFEST_FILE = "manifest.json";
const DEFAULT_VISUAL_FILE = "visual.json";
const GROUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const VISUAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CharacterGroupInfo = {
    groupId: string;
    name: string;
    description: string;
    enabled: boolean;
    sortOrder: number;
    characterCount: number;
};

export type CharacterVisualRef = {
    groupId: string;
    characterId: string;
    visualId: string;
};

export type CharacterVisualFileInfo = {
    visualId: string;
    fileName: string;
    createdAt: string;
    updatedAt: string;
    source: "manual" | "llm" | "migration" | "copy";
    active: boolean;
    invalid?: boolean;
};

export type CharacterVisualTreeCharacter = {
    characterId: string;
    files: CharacterVisualFileInfo[];
};

export type CharacterVisualTreeGroup = CharacterGroupInfo & {
    characters: CharacterVisualTreeCharacter[];
};

type GroupsFile = {
    schema: "nbook.character-groups/v2";
    groups: Array<{
        groupId: string;
        name: string;
        description: string;
        enabled: boolean;
        sortOrder: number;
    }>;
};

type ManifestFile = {
    schema: "nbook.character-visual-collection/v1";
    characterId: string;
    activeVisualId: string | null;
    visuals: Array<{
        visualId: string;
        fileName: string;
        createdAt: string;
        updatedAt: string;
        source: CharacterVisualFileInfo["source"];
    }>;
};

type LegacyVisualLocation = {
    groupId: string;
    characterId: string;
    filePath: string;
};

/**
 * v2 视觉资料库。旧的 lorebook/character 目录只作为迁移输入，迁移成功后
 * 运行时只读取 `.nbook/text-to-image/character-groups`。
 */
export class CharacterVisualLibraryService {
    async ensure(projectRoot: string): Promise<void> {
        const root = libraryRoot(projectRoot);
        await fs.mkdir(path.join(root, GROUP_DIRECTORY), {recursive: true});
        const groupsPath = path.join(root, GROUPS_FILE);
        if (await pathExists(groupsPath)) return;

        const groups: GroupsFile = {
            schema: "nbook.character-groups/v2",
            groups: [{
                groupId: "default",
                name: "默认分组",
                description: "未手动分组的角色视觉资料",
                enabled: true,
                sortOrder: 0,
            }],
        };
        await writeJsonAtomic(groupsPath, groups);
        await this.migrateLegacy(projectRoot, groups);
    }

    async listGroups(projectRoot: string): Promise<CharacterGroupInfo[]> {
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        const result: CharacterGroupInfo[] = [];
        for (const group of groups.groups) {
            result.push({
                ...group,
                characterCount: (await this.listCharacters(projectRoot, group.groupId)).length,
            });
        }
        return result.sort(compareGroups);
    }

    async createGroup(
        projectRoot: string,
        groupId: string,
        input?: {name?: string; description?: string},
    ): Promise<CharacterGroupInfo> {
        assertGroupId(groupId);
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        if (groups.groups.some((group) => group.groupId === groupId)) {
            throw new Error(`角色分组已存在：${groupId}`);
        }
        const nextOrder = groups.groups.reduce((max, group) => Math.max(max, group.sortOrder), -1) + 1;
        const group = {
            groupId,
            name: normalizeDisplayName(input?.name, groupId),
            description: input?.description?.trim() ?? "",
            enabled: false,
            sortOrder: nextOrder,
        };
        groups.groups.push(group);
        await writeGroups(projectRoot, groups);
        await fs.mkdir(groupDirectory(projectRoot, groupId), {recursive: true});
        return {...group, characterCount: 0};
    }

    async updateGroup(
        projectRoot: string,
        groupId: string,
        input: {name?: string; description?: string; enabled?: boolean; sortOrder?: number},
    ): Promise<CharacterGroupInfo> {
        assertGroupId(groupId);
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        const group = groups.groups.find((item) => item.groupId === groupId);
        if (!group) throw new Error(`未找到角色分组“${groupId}”`);
        if (input.name !== undefined) group.name = normalizeDisplayName(input.name, groupId);
        if (input.description !== undefined) group.description = input.description.trim();
        if (input.enabled !== undefined) group.enabled = input.enabled;
        if (input.sortOrder !== undefined) group.sortOrder = normalizeSortOrder(input.sortOrder);
        await writeGroups(projectRoot, groups);
        return {
            ...group,
            characterCount: (await this.listCharacters(projectRoot, groupId)).length,
        };
    }

    async setEnabledGroups(projectRoot: string, enabledGroupIds: string[]): Promise<CharacterGroupInfo[]> {
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        const enabled = new Set(enabledGroupIds);
        for (const id of enabled) assertGroupId(id);
        const known = new Set(groups.groups.map((group) => group.groupId));
        for (const id of enabled) {
            if (!known.has(id)) throw new Error(`未找到角色分组“${id}”`);
        }
        for (const group of groups.groups) group.enabled = enabled.has(group.groupId);
        await writeGroups(projectRoot, groups);
        return this.listGroups(projectRoot);
    }

    async reorderGroups(projectRoot: string, orderedGroupIds: string[]): Promise<CharacterGroupInfo[]> {
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        const known = new Set(groups.groups.map((group) => group.groupId));
        if (orderedGroupIds.length !== groups.groups.length || orderedGroupIds.some((id) => !known.has(id))) {
            throw new Error("角色分组排序列表不完整");
        }
        const order = new Map(orderedGroupIds.map((id, index) => [id, index]));
        for (const group of groups.groups) group.sortOrder = order.get(group.groupId) ?? group.sortOrder;
        await writeGroups(projectRoot, groups);
        return this.listGroups(projectRoot);
    }

    async deleteGroup(projectRoot: string, groupId: string): Promise<void> {
        assertGroupId(groupId);
        if (groupId === "default") throw new Error("default 分组不能删除");
        await this.ensure(projectRoot);
        const groups = await readGroups(projectRoot);
        const index = groups.groups.findIndex((group) => group.groupId === groupId);
        if (index < 0) return;
        const characters = await this.listCharacters(projectRoot, groupId);
        if (characters.length > 0) {
            throw new Error(`分组“${groupId}”仍有 ${characters.length} 个角色，请先移出或迁移视觉资料`);
        }
        groups.groups.splice(index, 1);
        await writeGroups(projectRoot, groups);
        await fs.rm(groupDirectory(projectRoot, groupId), {recursive: true, force: true});
    }

    async listCharacters(projectRoot: string, groupId: string): Promise<CharacterVisualTreeCharacter[]> {
        assertGroupId(groupId);
        await this.ensure(projectRoot);
        const directory = groupDirectory(projectRoot, groupId);
        const entries = await readDirectoryEntries(directory);
        const result: CharacterVisualTreeCharacter[] = [];
        for (const entry of entries) {
            const characterDirectory = path.join(directory, entry.name);
            if (!entry.isDirectory()) continue;
            const manifest = await readManifest(characterDirectory, entry.name);
            if (!manifest || manifest.visuals.length === 0) continue;
            result.push({
                characterId: entry.name,
                files: await listManifestVisualFiles(characterDirectory, manifest),
            });
        }
        return result.sort((left, right) => left.characterId.localeCompare(right.characterId));
    }

    async listTree(projectRoot: string): Promise<CharacterVisualTreeGroup[]> {
        const groups = await this.listGroups(projectRoot);
        return Promise.all(groups.map(async (group) => ({
            ...group,
            characters: await this.listCharacters(projectRoot, group.groupId),
        })));
    }

    async listVisualFiles(projectRoot: string, ref: {groupId: string; characterId: string}): Promise<CharacterVisualFileInfo[]> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        return manifest ? listManifestVisualFiles(directory, manifest) : [];
    }

    async read(
        projectRoot: string,
        ref: {groupId: string; characterId: string; visualId?: string},
    ): Promise<CharacterVisualFile | null> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        if (ref.visualId) assertVisualId(ref.visualId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        if (!manifest) return null;
        const item = ref.visualId
            ? manifest.visuals.find((visual) => visual.visualId === ref.visualId)
            : manifest.visuals.find((visual) => visual.visualId === manifest.activeVisualId) ?? manifest.visuals[0];
        if (!item) return null;
        return readVisualFile(path.join(directory, item.fileName));
    }

    async readWithInfo(
        projectRoot: string,
        ref: {groupId: string; characterId: string; visualId?: string},
    ): Promise<{visual: CharacterVisualFile; info: CharacterVisualFileInfo} | null> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        if (!manifest) return null;
        const item = ref.visualId
            ? manifest.visuals.find((visual) => visual.visualId === ref.visualId)
            : manifest.visuals.find((visual) => visual.visualId === manifest.activeVisualId) ?? manifest.visuals[0];
        if (!item) return null;
        const visual = await readVisualFile(path.join(directory, item.fileName));
        return visual ? {visual, info: {...item, active: manifest.activeVisualId === item.visualId}} : null;
    }

    async write(
        projectRoot: string,
        ref: {groupId: string; characterId: string; visualId?: string},
        input: CharacterVisualFile,
        options?: {fileName?: string; source?: CharacterVisualFileInfo["source"]; setActive?: boolean; expectedUpdatedAt?: string; allowCreate?: boolean},
    ): Promise<{ref: CharacterVisualRef; info: CharacterVisualFileInfo; visual: CharacterVisualFile}> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        await fs.mkdir(directory, {recursive: true});
        const manifest = await readManifest(directory, ref.characterId) ?? emptyManifest(ref.characterId);
        const current = ref.visualId
            ? manifest.visuals.find((visual) => visual.visualId === ref.visualId)
            : manifest.visuals.find((visual) => visual.visualId === manifest.activeVisualId);
        if (ref.visualId && !current && manifest.visuals.length > 0 && !options?.allowCreate) {
            throw new Error("未找到要写入的视觉资料");
        }
        if (options?.expectedUpdatedAt && current?.updatedAt !== options.expectedUpdatedAt) {
            throw new CharacterVisualRevisionConflictError(ref.characterId, ref.groupId, ref.visualId ?? current?.visualId ?? null);
        }
        const visualId = current?.visualId ?? ref.visualId ?? randomUUID();
        assertVisualId(visualId);
        const fileName = current?.fileName ?? normalizeVisualFileName(options?.fileName ?? DEFAULT_VISUAL_FILE);
        if (!current && (manifest.visuals.some((item) => item.fileName.toLocaleLowerCase() === fileName.toLocaleLowerCase())
            || await pathExists(path.join(directory, fileName)))) {
            throw new Error(`视觉资料文件已存在：${fileName}`);
        }
        const now = new Date().toISOString();
        const normalized = normalizeVisualIdentity(input, ref.characterId, visualId);
        await writeJsonAtomic(path.join(directory, fileName), normalized);
        const info: CharacterVisualFileInfo = {
            visualId,
            fileName,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
            source: options?.source ?? current?.source ?? "manual",
            active: options?.setActive ?? (manifest.activeVisualId === null || manifest.activeVisualId === visualId),
        };
        const next = manifest.visuals.filter((item) => item.visualId !== visualId);
        next.push({
            visualId,
            fileName,
            createdAt: info.createdAt,
            updatedAt: info.updatedAt,
            source: info.source,
        });
        manifest.visuals = next;
        if (options?.setActive === true || (options?.setActive !== false && (current !== undefined || manifest.activeVisualId === null))) {
            manifest.activeVisualId = visualId;
        }
        await writeJsonAtomic(path.join(directory, MANIFEST_FILE), manifest);
        return {
            ref: {groupId: ref.groupId, characterId: ref.characterId, visualId},
            info: {...info, active: manifest.activeVisualId === visualId},
            visual: normalized,
        };
    }

    async createCopy(
        projectRoot: string,
        source: CharacterVisualRef,
        target: {groupId: string; characterId?: string},
        options?: {fileName?: string},
    ): Promise<{ref: CharacterVisualRef; info: CharacterVisualFileInfo; visual: CharacterVisualFile}> {
        const visual = await this.read(projectRoot, source);
        if (!visual) throw new Error("未找到要复制的视觉资料");
        const characterId = target.characterId ?? source.characterId;
        const targetDirectory = characterDirectory(projectRoot, target.groupId, characterId);
        const targetManifest = await readManifest(targetDirectory, characterId);
        const fileName = options?.fileName
            ?? (targetManifest?.visuals.length ? await allocateVisualFileName(targetDirectory, undefined) : DEFAULT_VISUAL_FILE);
        const visualId = randomUUID();
        return this.write(projectRoot, {
            groupId: target.groupId,
            characterId,
            visualId,
        }, visual, {fileName, source: "copy", setActive: true, allowCreate: true});
    }

    async createNewVersion(
        projectRoot: string,
        ref: {groupId: string; characterId: string; baseVisualId?: string},
        input: CharacterVisualFile,
        options?: {fileName?: string; source?: CharacterVisualFileInfo["source"]; expectedUpdatedAt?: string},
    ): Promise<{ref: CharacterVisualRef; info: CharacterVisualFileInfo; visual: CharacterVisualFile}> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        await fs.mkdir(directory, {recursive: true});
        const manifest = await readManifest(directory, ref.characterId) ?? emptyManifest(ref.characterId);
        const base = ref.baseVisualId
            ? manifest.visuals.find((item) => item.visualId === ref.baseVisualId)
            : manifest.visuals.find((item) => item.visualId === manifest.activeVisualId);
        if (!base && manifest.visuals.length > 0) throw new Error("未找到当前视觉资料");
        if (base && options?.expectedUpdatedAt && base.updatedAt !== options.expectedUpdatedAt) {
            throw new CharacterVisualRevisionConflictError(ref.characterId, ref.groupId, base.visualId);
        }
        const fileName = await allocateVisualFileName(directory, options?.fileName);
        const visualId = randomUUID();
        return this.write(projectRoot, {
            groupId: ref.groupId,
            characterId: ref.characterId,
            visualId,
        }, input, {fileName, source: options?.source ?? "llm", setActive: true, allowCreate: true});
    }

    async renameVisual(
        projectRoot: string,
        ref: CharacterVisualRef,
        newFileName: string,
    ): Promise<CharacterVisualFileInfo> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        assertVisualId(ref.visualId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        const item = manifest?.visuals.find((visual) => visual.visualId === ref.visualId);
        if (!manifest || !item) throw new Error("未找到视觉资料");
        const fileName = normalizeVisualFileName(newFileName);
        if (manifest.visuals.some((visual) => visual.visualId !== ref.visualId && visual.fileName.toLocaleLowerCase() === fileName.toLocaleLowerCase())) {
            throw new Error(`视觉资料文件已存在：${fileName}`);
        }
        if (fileName !== item.fileName) {
            if (await pathExists(path.join(directory, fileName))) {
                throw new Error(`视觉资料文件已存在：${fileName}`);
            }
            await fs.rename(path.join(directory, item.fileName), path.join(directory, fileName));
        }
        item.fileName = fileName;
        item.updatedAt = new Date().toISOString();
        await writeJsonAtomic(path.join(directory, MANIFEST_FILE), manifest);
        return {...item, active: manifest.activeVisualId === item.visualId};
    }

    async setActiveVisual(projectRoot: string, ref: CharacterVisualRef): Promise<CharacterVisualFileInfo> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        assertVisualId(ref.visualId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        const item = manifest?.visuals.find((visual) => visual.visualId === ref.visualId);
        if (!manifest || !item) throw new Error("未找到视觉资料");
        manifest.activeVisualId = ref.visualId;
        await writeJsonAtomic(path.join(directory, MANIFEST_FILE), manifest);
        return {...item, active: true};
    }

    async deleteVisual(projectRoot: string, ref: CharacterVisualRef): Promise<void> {
        assertGroupId(ref.groupId);
        assertCharacterId(ref.characterId);
        assertVisualId(ref.visualId);
        await this.ensure(projectRoot);
        const directory = characterDirectory(projectRoot, ref.groupId, ref.characterId);
        const manifest = await readManifest(directory, ref.characterId);
        const item = manifest?.visuals.find((visual) => visual.visualId === ref.visualId);
        if (!manifest || !item) return;
        if (manifest.visuals.length <= 1) {
            throw new Error("每个分组至少保留一份视觉资料；请使用移出分组操作");
        }
        if (manifest.activeVisualId === ref.visualId) {
            throw new Error("当前生效视觉资料不能直接删除，请先切换当前版本");
        }
        const visual = await readVisualFile(path.join(directory, item.fileName));
        await fs.rm(path.join(directory, item.fileName), {force: true});
        await removeRegisteredPhotos(projectRoot, visual?.photos ?? []);
        manifest.visuals = manifest.visuals.filter((candidate) => candidate.visualId !== ref.visualId);
        await writeJsonAtomic(path.join(directory, MANIFEST_FILE), manifest);
    }

    async migrateLegacy(projectRoot: string, groups: GroupsFile): Promise<void> {
        const legacyLocations = await findLegacyVisuals(projectRoot);
        if (legacyLocations.length === 0) return;
        for (const location of legacyLocations) {
            if (location.groupId !== "default" && !groups.groups.some((group) => group.groupId === location.groupId)) {
                groups.groups.push({
                    groupId: location.groupId,
                    name: location.groupId,
                    description: "从旧角色视觉目录迁移",
                    // 旧版本没有启用开关；迁移时保持旧版“所有分组都参与正文扫描”的行为，
                    // 用户之后可以在“当前启用角色分组”中关闭任意分组。
                    enabled: true,
                    sortOrder: groups.groups.length,
                });
            }
            const target = characterDirectory(projectRoot, location.groupId, location.characterId);
            const targetManifest = await readManifest(target, location.characterId) ?? emptyManifest(location.characterId);
            if (targetManifest.visuals.length > 0) continue;
            let visual: CharacterVisualFile | null;
            try {
                visual = await readVisualFile(location.filePath);
            } catch {
                // 迁移不能让一个损坏的旧 JSON 阻塞整个 Project；保留原文件，
                // 用户可通过旧路径修复后再次执行迁移。
                continue;
            }
            if (!visual) continue;
            const visualId = randomUUID();
            const normalized = normalizeVisualIdentity(visual, location.characterId, visualId);
            const now = new Date().toISOString();
            await fs.mkdir(target, {recursive: true});
            await writeJsonAtomic(path.join(target, DEFAULT_VISUAL_FILE), normalized);
            targetManifest.activeVisualId = visualId;
            targetManifest.visuals = [{
                visualId,
                fileName: DEFAULT_VISUAL_FILE,
                createdAt: now,
                updatedAt: now,
                source: "migration",
            }];
            await writeJsonAtomic(path.join(target, MANIFEST_FILE), targetManifest);
        }
        await writeGroups(projectRoot, groups);
    }

    async getEffectiveVisuals(projectRoot: string): Promise<Array<CharacterVisualRef & {visual: CharacterVisualFile; group: CharacterGroupInfo}>> {
        const groups = (await this.listGroups(projectRoot)).filter((group) => group.enabled);
        const selected = new Map<string, CharacterVisualRef & {visual: CharacterVisualFile; group: CharacterGroupInfo}>();
        for (const group of groups) {
            for (const character of await this.listCharacters(projectRoot, group.groupId)) {
                const info = character.files.find((file) => file.active) ?? character.files[0];
                if (!info) continue;
                let visual: CharacterVisualFile | null;
                try {
                    visual = await this.read(projectRoot, {
                        groupId: group.groupId,
                        characterId: character.characterId,
                        visualId: info.visualId,
                    });
                } catch {
                    continue;
                }
                if (!visual || selected.has(character.characterId)) continue;
                selected.set(character.characterId, {
                    groupId: group.groupId,
                    characterId: character.characterId,
                    visualId: info.visualId,
                    visual,
                    group,
                });
            }
        }
        return [...selected.values()];
    }
}

export class CharacterVisualRevisionConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_CHARACTER_VISUAL_REVISION_CONFLICT";

    constructor(readonly characterId: string, readonly groupId: string, readonly visualId: string | null) {
        super(`角色“${characterId}”的视觉资料在生成期间已被修改，请重新加载后再提交。`);
        this.name = "CharacterVisualRevisionConflictError";
    }
}

function libraryRoot(projectRoot: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY);
}

function groupDirectory(projectRoot: string, groupId: string): string {
    return path.join(libraryRoot(projectRoot), GROUP_DIRECTORY, groupId);
}

function characterDirectory(projectRoot: string, groupId: string, characterId: string): string {
    return path.join(groupDirectory(projectRoot, groupId), characterId);
}

function normalizeDisplayName(value: string | undefined, fallback: string): string {
    return value?.trim() || fallback;
}

function normalizeSortOrder(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function assertGroupId(value: string): void {
    if (!GROUP_ID_PATTERN.test(value)) throw new Error(`非法 groupId：${value}`);
}

function assertCharacterId(value: string): void {
    const valid = value.length > 0
        && value === value.trim()
        && value !== "."
        && value !== ".."
        && !/[\\/\u0000]/u.test(value)
        && !/[\u0000-\u001f<>:"|?*]/u.test(value)
        && !/[. ]$/u.test(value)
        && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value);
    if (!valid) throw new Error(`非法 characterId：${value}`);
}

function assertVisualId(value: string): void {
    if (!VISUAL_ID_PATTERN.test(value)) throw new Error(`非法 visualId：${value}`);
}

function normalizeVisualFileName(value: string): string {
    const trimmed = value.trim();
    const fileName = trimmed.toLocaleLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
    const base = fileName.slice(0, -5);
    if (!base || base.length > 96 || fileName.toLocaleLowerCase() === MANIFEST_FILE || fileName.includes("/") || fileName.includes("\\")
        || /[\u0000-\u001f<>:"|?*]/u.test(fileName) || /[. ]$/u.test(fileName)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(base)) {
        throw new Error(`非法视觉资料文件名：${value}`);
    }
    return fileName;
}

function normalizeVisualIdentity(input: CharacterVisualFile, characterId: string, visualId: string): CharacterVisualFile {
    const triggerWords = [
        ...(input.character.triggerWords ?? "").split(",").map((word) => word.trim()).filter(Boolean),
        (input.character.cnName ?? "").trim(),
    ];
    return {
        ...input,
        schema: "nbook.character-visual/v1",
        visualId,
        characterId,
        character: {
            ...input.character,
            triggerWords: [...new Set(triggerWords)].join(", "),
        },
    };
}

function emptyManifest(characterId: string): ManifestFile {
    return {
        schema: "nbook.character-visual-collection/v1",
        characterId,
        activeVisualId: null,
        visuals: [],
    };
}

async function readGroups(projectRoot: string): Promise<GroupsFile> {
    const filePath = path.join(libraryRoot(projectRoot), GROUPS_FILE);
    try {
        const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<GroupsFile>;
        const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
        const normalizedGroups: GroupsFile["groups"] = [];
        const seenGroupIds = new Set<string>();
        for (const [index, group] of groups.entries()) {
            if (typeof group !== "object" || group === null) continue;
            const groupId = "groupId" in group && typeof group.groupId === "string" ? group.groupId : `group-${index}`;
            if (!GROUP_ID_PATTERN.test(groupId) || seenGroupIds.has(groupId)) continue;
            seenGroupIds.add(groupId);
            normalizedGroups.push({
                groupId,
                name: "name" in group && typeof group.name === "string" ? normalizeDisplayName(group.name, groupId) : groupId,
                description: "description" in group && typeof group.description === "string" ? group.description : "",
                enabled: "enabled" in group && group.enabled === true,
                sortOrder: "sortOrder" in group && typeof group.sortOrder === "number" ? normalizeSortOrder(group.sortOrder) : index,
            });
        }
        if (!normalizedGroups.some((group) => group.groupId === "default")) {
            normalizedGroups.unshift({groupId: "default", name: "默认分组", description: "", enabled: true, sortOrder: 0});
        }
        return {
            schema: "nbook.character-groups/v2",
            groups: normalizedGroups,
        };
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) {
            return {
                schema: "nbook.character-groups/v2",
                groups: [{groupId: "default", name: "默认分组", description: "", enabled: true, sortOrder: 0}],
            };
        }
        throw error;
    }
}

async function writeGroups(projectRoot: string, groups: GroupsFile): Promise<void> {
    await writeJsonAtomic(path.join(libraryRoot(projectRoot), GROUPS_FILE), groups);
}

async function readManifest(directory: string, characterId: string): Promise<ManifestFile | null> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(directory, MANIFEST_FILE), "utf8")) as Partial<ManifestFile>;
        if (!Array.isArray(raw.visuals)) return null;
        return {
            schema: "nbook.character-visual-collection/v1",
            characterId,
            activeVisualId: typeof raw.activeVisualId === "string" ? raw.activeVisualId : null,
            visuals: raw.visuals.filter((item): item is ManifestFile["visuals"][number] => (
                typeof item === "object" && item !== null
                && typeof item.visualId === "string"
                && typeof item.fileName === "string"
                && typeof item.createdAt === "string"
                && typeof item.updatedAt === "string"
                && (item.source === "manual" || item.source === "llm" || item.source === "migration" || item.source === "copy")
            )),
        };
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

async function readVisualFile(filePath: string): Promise<CharacterVisualFile | null> {
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

async function listManifestVisualFiles(directory: string, manifest: ManifestFile): Promise<CharacterVisualFileInfo[]> {
    const result: CharacterVisualFileInfo[] = [];
    for (const item of manifest.visuals) {
        let invalid = false;
        try {
            invalid = (await readVisualFile(path.join(directory, item.fileName))) === null;
        } catch {
            // 保留无法解析的 JSON 在树中，供用户定位和手工修复；读取详情时仍会报告原始解析错误。
            invalid = true;
        }
        result.push({
            ...item,
            active: manifest.activeVisualId === item.visualId,
            invalid,
        });
    }
    return result.sort((left, right) => (
        Number(right.active) - Number(left.active)
        || left.createdAt.localeCompare(right.createdAt)
        || left.fileName.localeCompare(right.fileName)
    ));
}

async function readDirectoryEntries(directory: string): Promise<import("node:fs").Dirent[]> {
    try {
        return await fs.readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return [];
        throw error;
    }
}

async function writeJsonAtomic(filePath: string, input: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
}

async function allocateVisualFileName(directory: string, requested?: string): Promise<string> {
    if (requested) return normalizeVisualFileName(requested);
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(".", "");
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const candidate = `visual-${stamp}-${suffix}.json`;
        try {
            const handle = await fs.open(path.join(directory, candidate), "wx");
            await handle.close();
            await fs.rm(path.join(directory, candidate), {force: true});
            return candidate;
        } catch (error) {
            if (!isErrorCode(error, "EEXIST")) throw error;
        }
    }
    throw new Error("无法生成不冲突的视觉资料文件名");
}

async function findLegacyVisuals(projectRoot: string): Promise<LegacyVisualLocation[]> {
    const root = path.join(projectRoot, "lorebook", "character");
    const entries = await readDirectoryEntries(root);
    const locations: LegacyVisualLocation[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const firstDirectory = path.join(root, entry.name);
        const directVisual = path.join(firstDirectory, DEFAULT_VISUAL_FILE);
        if (await pathExists(directVisual)) {
            locations.push({groupId: "default", characterId: entry.name, filePath: directVisual});
            continue;
        }
        const children = await readDirectoryEntries(firstDirectory);
        const hasGroupMarker = await pathExists(path.join(firstDirectory, ".group.json"));
        for (const child of children) {
            if (!child.isDirectory()) continue;
            const visualPath = path.join(firstDirectory, child.name, DEFAULT_VISUAL_FILE);
            if (await pathExists(visualPath)) {
                locations.push({groupId: hasGroupMarker || children.length > 0 ? entry.name : "default", characterId: child.name, filePath: visualPath});
            }
        }
    }
    return locations;
}

async function removeRegisteredPhotos(projectRoot: string, photos: string[]): Promise<void> {
    await Promise.all(photos
        .filter((relativePath) => relativePath.startsWith("assets/tti/"))
        .map((relativePath) => fs.rm(resolveTextToImageAssetPath(projectRoot, relativePath), {force: true})));
}

function compareGroups(left: CharacterGroupInfo, right: CharacterGroupInfo): number {
    return left.sortOrder - right.sortOrder || left.groupId.localeCompare(right.groupId);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return false;
        throw error;
    }
}
