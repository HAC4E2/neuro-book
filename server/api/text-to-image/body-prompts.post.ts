import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {generateBodyPrompts} from "nbook/server/text-to-image/body-session.service";
import {
    buildBodyCharacterSummary,
    buildBodyOutfitSummary,
    scanBodyCharactersFromProject,
} from "nbook/server/text-to-image/body-character-scanner";
import type {BodyCharacterMatch} from "nbook/server/text-to-image/body-character-scanner";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {readChapterMarkdown, readSameVolumeHistory} from "nbook/server/text-to-image/chapter.service";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {loadEffectiveConfig} from "nbook/server/config/config-service";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {
    readProjectSendData,
    readProjectSendDataSnapshot,
} from "nbook/server/text-to-image/project-send-data.service";

const BodyPromptsBodySchema = z.object({
    chapterContent: z.string().optional(),
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1),
    content: z.string().optional(),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, BodyPromptsBodySchema);
    const runtime = await resolveBoundTextToImageLlmRuntime(user.id, "image_gen");
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const effective = await loadEffectiveConfig({workspaceKind: "user-assets"});
    const profileName = effective.textToImage.currentWordReplacementProfile;
    const profile = effective.textToImage.wordReplacementProfiles[profileName];
    const projectRoot = resolveTextToImageProjectRoot(`workspace/${body.projectRoot}`);
    const chapterContent = body.content
        ?? body.chapterContent
        ?? await readChapterMarkdown(absoluteFsPath(projectRoot), body.path);
    const historyPrefill = await readSameVolumeHistory(
        absoluteFsPath(projectRoot),
        body.path,
        effective.textToImage.historyPrefillDepth,
    );
    const sendData = await readProjectSendData(projectRoot);
    const sendSnapshot = await readProjectSendDataSnapshot(projectRoot, sendData);
    if (sendSnapshot.missingItems?.length) {
        throw createError({
            statusCode: 409,
            message: `发送数据中存在已失效条目：${sendSnapshot.missingItems.join(", ")}；请先更新发送数据选择`,
        });
    }
    const scannedCharacters = await scanBodyCharactersFromProject({
        projectRoot,
        chapterContent,
    });

    if (chapterContent.trim() === "") {
        throw createError({statusCode: 400, message: "章节内容不能为空"});
    }

    const selectedCharacters = sendSnapshot.characters.map((item) => ({
        characterId: item.characterId,
        groupId: item.groupId,
        visual: item.visual,
        matchedTrigger: "project-send-data",
    }));
    const matchedCharacters = mergeBodyCharacterMatches(scannedCharacters, selectedCharacters);
    const resolvedCharacterSummary = buildBodyCharacterSummary(matchedCharacters);
    const selectedOutfits = sendSnapshot.outfits.map((item) => item.outfit);
    const worldBook = sendSnapshot.lorebookEntries
        .map((entry) => `<lorebook path="${entry.path}">\n${entry.content}\n</lorebook>`)
        .join("\n\n");
    const result = await generateBodyPrompts({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        chapterContent,
        characterMatches: matchedCharacters,
        textReplacementRules: profile?.textReplacement ?? "",
        aiReplacementRules: profile?.aiReplacement ?? "",
        contextEntries: runtime.contextEntries,
        historyPrefill,
        runtime: {
            body: chapterContent,
            context: resolvedCharacterSummary,
            worldBook,
            characterList: resolvedCharacterSummary,
            commonCharacterList: resolvedCharacterSummary,
            outfitList: buildBodyOutfitSummary(selectedOutfits),
            userDemand: "",
        },
    });
    return {
        blocks: result.blocks,
        content: result.content,
        placeholders: result.placeholders,
        characterSummary: result.characterSummary,
        matchedCharacters: result.matchedCharacters.map((match) => ({
            characterId: match.characterId,
            groupId: match.groupId,
            matchedTrigger: match.matchedTrigger,
        })),
    };
});

function mergeBodyCharacterMatches(
    scanned: BodyCharacterMatch[],
    selected: BodyCharacterMatch[],
): BodyCharacterMatch[] {
    const result = [...scanned];
    const indexes = new Map(scanned.map((match, index) => [match.characterId, index]));
    for (const match of selected) {
        const index = indexes.get(match.characterId);
        if (index === undefined) {
            indexes.set(match.characterId, result.length);
            result.push(match);
        } else {
            result[index] = match;
        }
    }
    return result;
}
