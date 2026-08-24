import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createCharacterGroup,
    readCharacterVisual,
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

describe("PUT /api/text-to-image/character-groups", () => {
    it("updates group metadata without changing the grouped character visual file", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "nbook-character-group-api-"));
        temporaryDirectories.push(root);
        await createCharacterGroup(root, "fantasy", {
            name: "Fantasy",
            description: "Original cast",
        });
        await writeCharacterVisual(root, "alice", visual(), "fantasy");

        const body = {
            projectRoot: root,
            groupId: "fantasy",
            name: "Main Cast",
            description: "Updated cast",
        };
        vi.doMock("h3", async () => {
            const actual = await vi.importActual<typeof import("h3")>("h3");
            return {
                ...actual,
                defineEventHandler: (handler: unknown) => handler,
            };
        });
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: (value: string) => value,
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => body),
        }));
        (globalThis as typeof globalThis & {defineEventHandler?: (handler: unknown) => unknown}).defineEventHandler = (handler) => handler;

        const handler = (await import("nbook/server/api/text-to-image/character-groups.put")).default as (
            event: never
        ) => Promise<{group: {groupId: string; name: string; description: string}}>;
        const result = await handler({} as never);

        expect(result).toEqual({
            group: {
                groupId: "fantasy",
                name: "Main Cast",
                description: "Updated cast",
            },
        });
        await expect(readCharacterVisual(root, "alice", "fantasy")).resolves.toMatchObject({
            characterId: "alice",
            character: {cnName: "Alice"},
        });
    });
});

function visual(): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        characterId: "alice",
        character: {
            cnName: "Alice",
            triggerWords: "alice",
        },
        outfits: [],
        photos: [],
    };
}
