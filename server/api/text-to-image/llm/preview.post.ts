import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageLlmProviderSettingsSchema, TextToImageRequestTypeSchema} from "nbook/shared/dto/text-to-image.dto";
import {buildRequestMessages, resolveTextToImageContextProfile} from "nbook/server/text-to-image/llm-context";
import {prepareLlmMessages} from "nbook/server/text-to-image/llm-chat";

const PreviewBodySchema = z.object({
    providerId: z.number().int().positive(),
    requestType: TextToImageRequestTypeSchema.default("image_gen"),
    prompt: z.string().default(""),
    runtime: z.object({
        body: z.string().default(""),
        context: z.string().default(""),
        worldBook: z.string().default(""),
        userDemand: z.string().default(""),
        characterList: z.string().default(""),
        commonCharacterList: z.string().default(""),
        outfitList: z.string().default(""),
        currentCharacter: z.string().default(""),
        currentOutfit: z.string().default(""),
        characterSource: z.string().default(""),
        currentTag: z.string().default(""),
        triggerText: z.string().default(""),
    }).partial().default({}),
}).strict();

/** 只准备实际发送消息、不调用 Provider 的预览接口。 */
export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, PreviewBodySchema);
    const provider = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(provider.settings);
    const profile = await resolveTextToImageContextProfile(body.requestType);
    const messages = prepareLlmMessages(
        buildRequestMessages(profile.entries, body.runtime, [{role: "user", content: body.prompt}], profile.promptMode),
        body.runtime,
        {sendImages: settings.sendImages, mergeSystemUser: settings.mergeSystemUser},
    );
    return {
        messages,
        requestType: body.requestType,
        profileId: profile.id,
        promptMode: profile.promptMode,
        diagnostics: [],
    };
});
