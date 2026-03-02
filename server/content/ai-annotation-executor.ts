import {HumanMessage, SystemMessage} from "@langchain/core/messages";
import {applyPatch} from "diff";
import {parseAiAnnotationBlocks, type AiAnnotationBlock} from "nbook/server/content/ai-annotation";
import {useChatModel} from "nbook/server/utils/model";

export type AiAnnotationExecutionContext = {
    module: "chapter" | "lorebook" | "plot";
    field: string;
    entityLabel: string;
};

/**
 * 执行单个文本字段中的 AI 批注块。
 * v1 采用整字段一次模型调用，由模型返回 unified diff。
 */
export class AiAnnotationExecutor {
    /**
     * 执行 AI 批注，并返回最终 resolved 文本。
     */
    async execute(
        text: string,
        annotations: AiAnnotationBlock[],
        context: AiAnnotationExecutionContext,
    ): Promise<string> {
        if (annotations.length === 0) {
            return text;
        }

        const model = useChatModel();
        const response = await model.invoke([
            new SystemMessage([
                "你是内容修订引擎。",
                "你会收到一个文本字段，其中包含 AI 批注块。",
                "你的任务是根据批注要求修改整段文本，并只输出一个 unified diff 补丁。",
                "禁止输出解释、前言、结语、Markdown 代码块或任何 diff 之外的内容。",
                "补丁必须以 --- original 和 +++ updated 开头，并且能够直接应用到原文。",
                "所有 `%{...}%` 和 `%!{...}%` 批注块都必须在最终文本中被处理并移除。",
            ].join("\n")),
            new HumanMessage(buildExecutionPrompt(text, annotations, context)),
        ]);
        const patch = normalizeUnifiedDiff(response.text);
        const resolved = applyPatch(text, patch, {fuzzFactor: 0});

        if (resolved === false) {
            throwAiExecutionError("AI 批注补丁应用失败");
        }

        const remainingAnnotations = tryParseAnnotations(resolved);
        if (remainingAnnotations === null) {
            throwAiExecutionError("AI 批注执行结果不合法");
        }
        if (remainingAnnotations.length > 0) {
            throwAiExecutionError("AI 批注执行后仍残留未处理的批注块");
        }

        return resolved;
    }
}

/**
 * 构造执行 prompt。
 */
function buildExecutionPrompt(
    text: string,
    annotations: AiAnnotationBlock[],
    context: AiAnnotationExecutionContext,
): string {
    const blocks = annotations.map((annotation, index) => [
        `#${String(index + 1)}`,
        `kind: ${annotation.kind}`,
        `prompt: ${annotation.prompt}`,
        `range: ${String(annotation.rangeStart)}-${String(annotation.rangeEnd)}`,
        `raw: ${annotation.raw}`,
    ].join("\n"));

    return [
        `模块：${context.module}`,
        `字段：${context.field}`,
        `对象：${context.entityLabel}`,
        "",
        "【原始字段文本】",
        text,
        "",
        "【识别出的 AI 批注块】",
        blocks.join("\n\n"),
        "",
        "请直接输出针对【原始字段文本】的 unified diff。",
    ].join("\n");
}

/**
 * 规范化模型输出，只接受 unified diff。
 */
function normalizeUnifiedDiff(text: string): string {
    const trimmed = text.trim();
    const fencedMatch = trimmed.match(/^```(?:diff)?\s*([\s\S]*?)```$/);
    const patchText = fencedMatch?.[1]?.trim() ?? trimmed;

    if (!patchText.startsWith("--- ") || !patchText.includes("\n+++ ") || !patchText.includes("\n@@")) {
        throwAiExecutionError("AI 批注未返回合法的 unified diff");
    }

    return patchText;
}

/**
 * 尝试解析执行结果中的批注块。
 */
function tryParseAnnotations(text: string): AiAnnotationBlock[] | null {
    try {
        return parseAiAnnotationBlocks(text);
    } catch {
        return null;
    }
}

/**
 * 抛出 AI 批注执行错误。
 */
function throwAiExecutionError(message: string): never {
    throw createError({
        statusCode: 502,
        message,
    });
}
