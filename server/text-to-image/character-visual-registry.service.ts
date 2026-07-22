import path from "node:path";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import type {
    CharacterImageTagHashes,
    CharacterImageTags,
    OutfitTags,
} from "nbook/shared/text-to-image-character-visual";
import {
    parseCharacterImageTagsMarkdown,
    parseOutfitTagsMarkdown,
} from "nbook/server/text-to-image/character-visual.codec";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {resolveWorkspaceRootInput} from "nbook/server/text-to-image/compat";
import {readWorkspaceTextFile, scanWorkspaceTree} from "nbook/server/workspace-files/workspace-files";

export type CharacterVisualRegistryFileStore = {
    resolveProjectRoot(projectPath: string): Promise<string>;
    assertProjectOpen(projectPath: string, root: string): void;
    listPaths(root: string, prefix: string): Promise<string[]>;
    read(root: string, filePath: string): Promise<string | null>;
};

export type CharacterVisualRegistrySnapshot = {
    characters: Array<{
        path: string;
        fileHash: string;
        character: CharacterImageTags;
        hashes: CharacterImageTagHashes;
        outfits: Array<{
            path: string;
            fileHash: string;
            outfit: OutfitTags;
            hashes: CharacterImageTagHashes;
        }>;
    }>;
    visualPlanningFactsHash: string;
    renderTagFactsHash: string;
};

export type CharacterVisualRegistryErrorCode =
    | "CHARACTER_VISUAL_MIGRATION_REQUIRED"
    | "CHARACTER_VISUAL_INVALID";

/** Route B V2-only 角色事实错误；不存在 legacy fallback。 */
export class CharacterVisualRegistryError extends Error {
    readonly code: CharacterVisualRegistryErrorCode;

    constructor(code: CharacterVisualRegistryErrorCode, message: string) {
        super(message);
        this.name = "CharacterVisualRegistryError";
        this.code = code;
    }
}

/** 只消费已迁移 V2 文件的 Project 角色视觉事实 registry。 */
export class CharacterVisualRegistryService {
    private readonly store: CharacterVisualRegistryFileStore;

    constructor(options: {store?: CharacterVisualRegistryFileStore} = {}) {
        this.store = options.store ?? new WorkspaceCharacterVisualRegistryStore();
    }

    /** 读取并复验全部角色与其显式 outfit refs；任一 legacy/交叉 owner 使整份 registry 失败。 */
    async read(input: {projectPath: string}): Promise<CharacterVisualRegistrySnapshot> {
        const root = await this.store.resolveProjectRoot(input.projectPath);
        this.store.assertProjectOpen(input.projectPath, root);
        const paths = await this.store.listPaths(root, "lorebook/character");
        const characters: CharacterVisualRegistrySnapshot["characters"] = [];
        for (const characterPath of paths.filter((filePath) => filePath.endsWith("/image-tags.md"))) {
            const characterMarkdown = await this.requireFile(root, characterPath);
            let parsedCharacter: ReturnType<typeof parseCharacterImageTagsMarkdown>;
            try {
                parsedCharacter = parseCharacterImageTagsMarkdown(characterMarkdown);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new CharacterVisualRegistryError(
                    "CHARACTER_VISUAL_MIGRATION_REQUIRED",
                    `${characterPath} 尚未迁移为严格 Character Image Tags V2：${message}`,
                );
            }
            const characterDirectory = path.posix.dirname(characterPath);
            if (path.posix.basename(characterDirectory) !== parsedCharacter.character.characterId) {
                throw new CharacterVisualRegistryError("CHARACTER_VISUAL_INVALID", `${characterPath} 的 characterId 与目录 identity 不一致`);
            }
            const outfits: CharacterVisualRegistrySnapshot["characters"][number]["outfits"] = [];
            for (const outfitRef of parsedCharacter.character.outfitRefs) {
                const outfitPath = `${characterDirectory}/${outfitRef}`;
                const outfitMarkdown = await this.requireFile(root, outfitPath);
                let parsedOutfit: ReturnType<typeof parseOutfitTagsMarkdown>;
                try {
                    parsedOutfit = parseOutfitTagsMarkdown(outfitMarkdown);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new CharacterVisualRegistryError("CHARACTER_VISUAL_INVALID", `${outfitPath} 不是严格 Outfit Tags V2：${message}`);
                }
                const expectedOutfitId = path.posix.basename(outfitPath, ".md");
                if (parsedOutfit.outfit.ownerCharacterId !== parsedCharacter.character.characterId
                    || parsedOutfit.outfit.outfitId !== expectedOutfitId) {
                    throw new CharacterVisualRegistryError("CHARACTER_VISUAL_INVALID", `${outfitPath} 的 owner/outfitId 与角色引用不一致`);
                }
                outfits.push({
                    path: outfitPath,
                    fileHash: parsedOutfit.fileHash,
                    outfit: parsedOutfit.outfit,
                    hashes: parsedOutfit.hashes,
                });
            }
            characters.push({
                path: characterPath,
                fileHash: parsedCharacter.fileHash,
                character: parsedCharacter.character,
                hashes: parsedCharacter.hashes,
                outfits,
            });
        }
        const planningFacts = characters.map((entry) => ({
            path: entry.path,
            visualPlanningFactsHash: entry.hashes.visualPlanningFactsHash,
            outfits: entry.outfits.map((outfit) => ({path: outfit.path, visualPlanningFactsHash: outfit.hashes.visualPlanningFactsHash})),
        }));
        const renderFacts = characters.map((entry) => ({
            path: entry.path,
            renderTagFactsHash: entry.hashes.renderTagFactsHash,
            outfits: entry.outfits.map((outfit) => ({path: outfit.path, renderTagFactsHash: outfit.hashes.renderTagFactsHash})),
        }));
        return {
            characters,
            visualPlanningFactsHash: hashTextToImageContract({characters: planningFacts}),
            renderTagFactsHash: hashTextToImageContract({characters: renderFacts}),
        };
    }

    /** 要求 referenced V2 文件存在。 */
    private async requireFile(root: string, filePath: string): Promise<string> {
        const content = await this.store.read(root, filePath);
        if (content === null) {
            throw new CharacterVisualRegistryError("CHARACTER_VISUAL_INVALID", `角色视觉引用文件不存在：${filePath}`);
        }
        return content;
    }
}

/** 生产 Project 只读 store。 */
class WorkspaceCharacterVisualRegistryStore implements CharacterVisualRegistryFileStore {
    async resolveProjectRoot(projectPath: string): Promise<string> {
        const root = await resolveWorkspaceRootInput({projectPath});
        if (!root) throw new CharacterVisualRegistryError("CHARACTER_VISUAL_INVALID", "Project Workspace root 缺失");
        return root;
    }

    assertProjectOpen(projectPath: string, _root: string): void {
        assertProjectOpen(projectPath);
    }

    async listPaths(root: string, prefix: string): Promise<string[]> {
        const nodes = await scanWorkspaceTree({root: root as any, targets: [prefix], depth: null, recursive: true});
        return nodes.filter((node) => !node.isDirectory).map((node) => node.path).sort(compareText);
    }

    async read(root: string, filePath: string): Promise<string | null> {
        try {
            return await readWorkspaceTextFile(root as any, filePath);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }
}

/** Node ENOENT 识别。 */
function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** locale-independent code point 顺序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
