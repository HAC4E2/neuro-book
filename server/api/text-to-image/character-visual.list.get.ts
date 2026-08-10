import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {
    listCharacterGroups,
    listCharacterDocumentLocations,
    listCharacterVisualIds,
    listLegacyCharacterVisualIds,
    readCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterVisualListQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1).optional(),
    enabledOnly: z.preprocess(
        (value) => value === true || value === "true",
        z.boolean().default(false),
    ),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = CharacterVisualListQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        const firstIssue = query.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "Invalid request",
        });
    }

    const projectRoot = resolveTextToImageProjectRoot(query.data.projectRoot);
    const characters = [];
    const documents = await listCharacterDocumentLocations(projectRoot);
    if (query.data.groupId) {
        const seen = new Set<string>();
        for (const characterId of await listCharacterVisualIds(projectRoot, query.data.groupId)) {
            const visual = await readCharacterVisual(projectRoot, characterId, query.data.groupId);
            if (visual === null) continue;
            seen.add(characterId);
            characters.push({
                characterId,
                groupId: query.data.groupId,
                characterPage: documents.find((item) => item.characterId === characterId && item.groupId === query.data.groupId)?.relativePath ?? "",
                cnName: visual.character.cnName,
                enName: visual.character.enName,
                triggerWords: visual.character.triggerWords,
            });
        }
        for (const document of documents.filter((item) => item.groupId === query.data.groupId && !seen.has(item.characterId))) {
            if (query.data.enabledOnly) continue;
            characters.push({
                characterId: document.characterId,
                groupId: document.groupId,
                characterPage: document.relativePath,
                cnName: "",
                enName: "",
                triggerWords: "",
            });
        }
        return {characters};
    }

    const seen = new Set<string>();
    for (const group of await listCharacterGroups(projectRoot)) {
        for (const characterId of await listCharacterVisualIds(projectRoot, group.groupId)) {
            const visual = await readCharacterVisual(projectRoot, characterId, group.groupId);
            if (visual === null) continue;
            if (query.data.enabledOnly && !visual.character.triggerWords?.trim()) continue;
            seen.add(`${group.groupId}:${characterId}`);
            characters.push({
                characterId,
                groupId: group.groupId,
                characterPage: documents.find((item) => item.characterId === characterId && item.groupId === group.groupId)?.relativePath ?? "",
                cnName: visual.character.cnName,
                enName: visual.character.enName,
                triggerWords: visual.character.triggerWords,
            });
        }
    }
    for (const characterId of await listLegacyCharacterVisualIds(projectRoot)) {
        const visual = await readCharacterVisual(projectRoot, characterId);
        if (visual === null) continue;
        if (query.data.enabledOnly && !visual.character.triggerWords?.trim()) continue;
        seen.add(`legacy:${characterId}`);
        characters.push({
            characterId,
            groupId: null,
            characterPage: documents.find((item) => item.characterId === characterId && item.groupId === null)?.relativePath ?? "",
            cnName: visual.character.cnName,
            enName: visual.character.enName,
            triggerWords: visual.character.triggerWords,
        });
    }
    for (const document of documents) {
        const key = `${document.groupId ?? "legacy"}:${document.characterId}`;
        if (seen.has(key) || query.data.enabledOnly) continue;
        characters.push({
            characterId: document.characterId,
            groupId: document.groupId,
            characterPage: document.relativePath,
            cnName: "",
            enName: "",
            triggerWords: "",
        });
    }
    return {characters};
});
