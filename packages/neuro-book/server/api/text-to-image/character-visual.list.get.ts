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
    enabledOnly: z.preprocess(
        (value) => value === true || value === "true",
        z.boolean().default(false),
    ),
}).strict();

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
                characterPagePath: documents.find((item) => item.characterId === characterId && item.groupId === group.groupId)?.relativePath ?? "",
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
            characterPagePath: documents.find((item) => item.characterId === characterId && item.groupId === null)?.relativePath ?? "",
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
            characterPagePath: document.relativePath,
            cnName: "",
            enName: "",
            triggerWords: "",
        });
    }
    return {characters};
});
