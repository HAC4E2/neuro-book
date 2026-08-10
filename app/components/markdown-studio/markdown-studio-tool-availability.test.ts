import {describe, expect, it} from "vitest";
import {
    isBodyTextToImageEnabled,
    isCharacterTagGenerateEnabled,
} from "nbook/app/components/markdown-studio/markdown-studio-tool-availability";
import {
    characterListItemKey,
    filterCharacterList,
} from "nbook/app/components/novel-ide/text-to-image/character-list";

describe("Markdown Studio text-to-image tool availability", () => {
    it("enables body generation only for an editable chapter content node", () => {
        const base = {
            projectSurfaceActive: true,
            userAssetsWorkspace: false,
            agentMode: false,
            editorKind: "markdown" as const,
            currentMarkdownFile: true,
            currentFileEditable: true,
            currentContentNode: true,
            currentEntryType: "chapter",
            currentFilePath: "manuscript/001-volume/001-chapter/index.md",
        };

        expect(isBodyTextToImageEnabled(base)).toBe(true);
        expect(isBodyTextToImageEnabled({...base, currentFilePath: "manuscript/reference.md", currentEntryType: "file"})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, currentFilePath: "manuscript/001-volume/index.md", currentEntryType: "volume"})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, currentFilePath: "lorebook/character/alice/index.md", currentEntryType: "character"})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, currentContentNode: false})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, userAssetsWorkspace: true})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, agentMode: true})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, editorKind: "monaco"})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, currentMarkdownFile: false})).toBe(false);
        expect(isBodyTextToImageEnabled({...base, currentFileEditable: false})).toBe(false);
    });

    it("enables character tag generation only for a character detail page", () => {
        const base = {
            projectSurfaceActive: true,
            userAssetsWorkspace: false,
            agentMode: false,
            editorKind: "markdown" as const,
            currentMarkdownFile: true,
            currentFileEditable: true,
            currentContentNode: true,
            currentEntryType: "character",
            currentFilePath: "lorebook/character/alice/index.md",
            frontmatterProfileKind: "character" as const,
        };

        expect(isCharacterTagGenerateEnabled(base)).toBe(true);
        expect(isCharacterTagGenerateEnabled({...base, currentFilePath: "manuscript/chapter.md"})).toBe(false);
        expect(isCharacterTagGenerateEnabled({...base, currentFilePath: "lorebook/character/alice/notes.md"})).toBe(false);
        expect(isCharacterTagGenerateEnabled({...base, currentContentNode: false})).toBe(false);
        expect(isCharacterTagGenerateEnabled({...base, currentEntryType: "location"})).toBe(false);
        expect(isCharacterTagGenerateEnabled({...base, frontmatterProfileKind: null})).toBe(false);
        expect(isCharacterTagGenerateEnabled({...base, editorKind: "monaco"})).toBe(false);
    });
});

describe("character list group identity", () => {
    it("keeps same character ids distinct across groups", () => {
        expect(characterListItemKey({characterId: "alice", groupId: "fantasy"}))
            .not.toBe(characterListItemKey({characterId: "alice", groupId: "modern"}));
        expect(characterListItemKey({characterId: "alice", groupId: null}))
            .not.toBe(characterListItemKey({characterId: "alice", groupId: "default"}));
    });

    it("filters the independent character list without dropping cross-group entries", () => {
        const items = [
            {characterId: "alice", groupId: "fantasy", cnName: "Alice", enName: "Alice", triggerWords: "alice"},
            {characterId: "alice", groupId: "modern", cnName: "Alice", enName: "Alice", triggerWords: "alice"},
            {characterId: "bob", groupId: null, cnName: "Bob", enName: "Bob", triggerWords: ""},
        ];

        expect(filterCharacterList(items, "all").map(characterListItemKey))
            .toEqual(["fantasy:alice", "modern:alice", "legacy:bob"]);
        expect(filterCharacterList(items, "fantasy").map(characterListItemKey))
            .toEqual(["fantasy:alice"]);
        expect(filterCharacterList(items, "__legacy__").map(characterListItemKey))
            .toEqual(["legacy:bob"]);
    });
});
