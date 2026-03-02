import {HumanMessage, SystemMessage} from "@langchain/core/messages";
import {createEventStream} from "h3";
import consola from "consola";
import {useChatModel} from "nbook/server/utils/model";
import {
    NovelContinueRequestDtoSchema,
    type NovelContinueRequestDto,
} from "nbook/shared/dto/novel.dto";

/**
 * 校验续写请求参数，非法时直接抛出 HTTP 错误。
 */
const validateBody = (body: unknown): NovelContinueRequestDto => {
    const parseResult = NovelContinueRequestDtoSchema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
};

/**
 * AI 小说续写流式接口：
 * - 请求体：{ content, requirement }
 * - 返回：SSE(token/done/error)
 */
export default defineEventHandler(async (event) => {
    const body = await readBody(event);
    const {content, requirement} = validateBody(body);

    const eventStream = createEventStream(event);
    eventStream.onClosed(() => {
        return eventStream.close();
    });

    const model = useChatModel();
    const prompt = [
        new SystemMessage("你是专业小说作者。你只输出“新增续写内容”，不要重复用户已有正文。保持语气、叙事视角和节奏一致。"),
        new HumanMessage(`【已有正文】\n${content}\n\n【续写要求】\n${requirement}\n\n请基于正文继续创作。`),
    ];

    void (async () => {
        try {
            consola.info(
                {contentLength: content.length, requirementLength: requirement.length},
                "小说续写请求开始",
            );

            let fullText = "";
            const responseStream = await model.stream(prompt);
            for await (const chunk of responseStream) {
                const text = typeof chunk.text === "string" ? chunk.text : "";
                if (!text) {
                    continue;
                }
                fullText += text;
                await eventStream.push({
                    event: "token",
                    data: JSON.stringify({text}),
                });
            }

            await eventStream.push({
                event: "done",
                data: JSON.stringify({fullText}),
            });
            consola.info({generatedLength: fullText.length}, "小说续写请求完成");
        } catch (error) {
            const message = error instanceof Error ? error.message : "续写失败";
            consola.error({message}, "小说续写请求失败");
            await eventStream.push({
                event: "error",
                data: JSON.stringify({message}),
            });
        } finally {
            await eventStream.close();
        }
    })();

    return eventStream.send();
});
