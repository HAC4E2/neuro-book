import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {generateBodyPrompts} from "nbook/server/text-to-image/body-session.service";
import {
    buildBodyCharacterSummary,
    buildBodyOutfitSummary,
    CharacterTriggerAmbiguityError,
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
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

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
    const trace = textToImageLlmTraceHub.start(user.id, {requestType: "image_gen", profileId: runtime.profileId, model: settings.model});
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
    }).catch((cause: unknown) => {
        if (cause instanceof CharacterTriggerAmbiguityError) {
            // 歧义错误不能静默按遍历顺序选择，也不能进入 LLM。
            throw createError({statusCode: 409, message: cause.message});
        }
        throw cause;
    });

    if (chapterContent.trim() === "") {
        throw createError({statusCode: 400, message: "章节内容不能为空"});
    }

    const selectedCharacters = sendSnapshot.characters.map((item) => ({
        characterId: item.characterId,
        groupId: item.groupId,
        visual: item.visual,
        matchedTrigger: "project-send-data",
        matchedTriggers: [],
        source: "project-send-data" as const,
    }));
    const matchedCharacters = mergeBodyCharacterMatches(scannedCharacters, selectedCharacters);
    const resolvedCharacterSummary = buildBodyCharacterSummary(matchedCharacters);
    const selectedOutfits = sendSnapshot.outfits.map((item) => item.outfit);
    const worldBook = sendSnapshot.lorebookEntries
        .map((entry) => `<lorebook path="${entry.path}">\n${entry.content}\n</lorebook>`)
        .join("\n\n");
    let result: Awaited<ReturnType<typeof generateBodyPrompts>>;
    try {
        result = await generateBodyPrompts({
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
            promptMode: runtime.promptMode,
            trace,
            historyPrefill,
            runtime: {
                body: chapterContent,
                context: resolvedCharacterSummary,
                worldBook,
                characterList: resolvedCharacterSummary,
                commonCharacterList: resolvedCharacterSummary,
                outfitList: buildBodyOutfitSummary(selectedOutfits),
                userDemand: "",
                triggerText: `${chapterContent}\n${resolvedCharacterSummary}\n${worldBook}`,
            },
        });
    } catch (cause) {
        if (isBodyImagePlanningFormatError(cause)) {
            throw createError({
                statusCode: 422,
                message: "正文生图规划格式不完整，已重试 2 次；请重新点击“生成图片”",
            });
        }
        throw cause;
    }
    return {
        blocks: result.blocks,
        content: result.content,
        placeholders: result.placeholders,
        characterSummary: result.characterSummary,
        matchedCharacters: result.matchedCharacters.map((match) => ({
            characterId: match.characterId,
            groupId: match.groupId,
            matchedTrigger: match.matchedTrigger,
            source: match.source,
        })),
    };
});

function isBodyImagePlanningFormatError(error: unknown): boolean {
    return error instanceof Error
        && (/正文生图块解析失败/u.test(error.message)
            || /角色调用格式无效/u.test(error.message)
            || /角色调用格式门禁/u.test(error.message));
}

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
