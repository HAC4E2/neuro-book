import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {generateBodyPrompts} from "nbook/server/text-to-image/body-session.service";
import {
    buildBodyCharacterSummary,
    scanBodyCharactersFromProject,
} from "nbook/server/text-to-image/body-character-scanner";
import type {BodyCharacterMatch} from "nbook/server/text-to-image/body-character-scanner";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {readChapterMarkdown} from "nbook/server/text-to-image/chapter.service";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {loadEffectiveConfig} from "nbook/server/config/config-service";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";

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
    const matchedCharacters = await scanBodyCharactersFromProject({
        projectRoot,
        chapterContent,
    });

    if (chapterContent.trim() === "") {
        throw createError({statusCode: 400, message: "章节内容不能为空"});
    }

    const resolvedCharacterSummary = buildBodyCharacterSummary(matchedCharacters);
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
        runtime: {
            body: chapterContent,
            context: resolvedCharacterSummary,
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
