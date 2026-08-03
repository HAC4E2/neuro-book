import {z} from "zod";
import {defineEventHandler} from "h3";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requestLlmCompletion} from "nbook/server/text-to-image/llm-chat";
import {TextToImageLlmProviderSettingsSchema, TextToImageRequestTypeSchema} from "nbook/shared/dto/text-to-image.dto";
import {buildContextMessages, resolveTextToImageContextEntries} from "nbook/server/text-to-image/llm-context";

const LlmTestBodySchema = z.object({
    providerId: z.number().int().positive(),
    prompt: z.string().trim().min(1),
    stream: z.boolean().optional().default(false),
    requestType: TextToImageRequestTypeSchema.optional().default("image_gen"),
    runtime: z.object({
        body: z.string().optional().default(""),
        context: z.string().optional().default(""),
        userDemand: z.string().optional().default(""),
        worldBook: z.string().optional().default(""),
    }).optional().default({
        body: "",
        context: "",
        userDemand: "",
        worldBook: "",
    }),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, LlmTestBodySchema);
    const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const content = await requestLlmCompletion({
        baseUrl: settings.baseUrl,
        credential: runtime.credential,
        model: settings.model,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        stream: body.stream ?? settings.stream,
        sendImages: settings.sendImages,
        mergeSystemUser: settings.mergeSystemUser,
        retryCount: settings.retryCount,
        runtime: body.runtime,
        messages: [
            ...buildContextMessages(await resolveTextToImageContextEntries(body.requestType), body.runtime),
            {role: "user", content: body.prompt},
        ],
    });
    return {content};
});
