import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createCharacterGroup,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("GET /api/text-to-image/character-visual.list", () => {
    it("rejects a browser-supplied groupId because the UI exposes one Project collection", async () => {
        const handler = await loadHandler({projectRoot: "demo", groupId: "legacy-group"});

        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 400});
    });

    it("without groupId returns every project character while preserving group identity", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy", {name: "Fantasy"});
        await writeCharacterVisual(root, "alice", visual("Alice", "alice, alice-in-wonderland"), "fantasy");
        await writeCharacterVisual(root, "bob", visual("Bob", ""), "fantasy");
        await writeCharacterVisual(root, "hero", visual("Hero", "hero"), undefined);
        await writeCharacterVisual(root, "side", visual("Side", " "), undefined);

        const handler = await loadHandler({projectRoot: root});
        const result = await handler({} as never);

        expect(result).toEqual({
            characters: [
                expect.objectContaining({characterId: "alice", groupId: "fantasy", triggerWords: "alice, alice-in-wonderland, Alice"}),
                expect.objectContaining({characterId: "bob", groupId: "fantasy", triggerWords: "Bob"}),
                expect.objectContaining({characterId: "hero", groupId: null, triggerWords: "hero, Hero"}),
                expect.objectContaining({characterId: "side", groupId: null, triggerWords: "Side"}),
            ],
        });
    });

    it("with enabledOnly returns only characters with trigger words", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy", {name: "Fantasy"});
        await writeCharacterVisual(root, "alice", visual("Alice", "alice"), "fantasy");
        await writeCharacterVisual(root, "bob", visual("Bob", ""), "fantasy");

        const handler = await loadHandler({projectRoot: root, enabledOnly: "true"});
        const result = await handler({} as never);

        expect(result.characters).toEqual([
            expect.objectContaining({characterId: "alice", groupId: "fantasy", triggerWords: "alice, Alice"}),
            expect.objectContaining({characterId: "bob", groupId: "fantasy", triggerWords: "Bob"}),
        ]);
    });

    it("视觉资料删除后仍从原始角色 index.md 列出角色", async () => {
        const root = await createRoot();
        const characterDirectory = path.join(root, "lorebook", "character", "hero");
        await mkdir(characterDirectory, {recursive: true});
        await writeFile(path.join(characterDirectory, "index.md"), "# 林砚舟\n", "utf8");

        const handler = await loadHandler({projectRoot: root});
        const result = await handler({} as never);

        expect(result.characters).toEqual([
            expect.objectContaining({
                characterId: "hero",
                groupId: null,
                characterPage: "lorebook/character/hero/index.md",
            }),
        ]);
    });
});

function visual(cnName: string, triggerWords: string): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        characterId: cnName.toLowerCase(),
        character: {cnName, triggerWords},
        outfits: [],
        photos: [],
    };
}

async function loadHandler(query: {projectRoot: string; groupId?: string; enabledOnly?: string}): Promise<(event: never) => Promise<{characters: unknown[]}>> {
    vi.doMock("h3", async () => {
        const actual = await vi.importActual<typeof import("h3")>("h3");
        return {
            ...actual,
            defineEventHandler: (handler: unknown) => handler,
            getQuery: vi.fn(() => query),
        };
    });
    vi.doMock("nbook/server/text-to-image/auth", () => ({
        requireTextToImageUser: vi.fn(async () => ({id: 1})),
    }));
    vi.doMock("nbook/server/text-to-image/project-client", () => ({
        resolveTextToImageProjectRoot: (value: string) => value,
    }));
    (globalThis as typeof globalThis & {defineEventHandler?: (handler: unknown) => unknown}).defineEventHandler = (handler) => handler;
    return (await import("nbook/server/api/text-to-image/character-visual.list.get")).default as never;
}

async function createRoot(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-character-visual-list-"));
    temporaryDirectories.push(directory);
    return directory;
}
