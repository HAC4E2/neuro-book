/** chatu-8 token 计算前的文本预处理；权重语法与包裹符不计入 T5 tokenizer。 */
export function normalizeNovelAiTokenText(prompt: string): string {
    return prompt
        .replace(/::\s*-?\d+(?:\.\d+)?/gu, "")
        .replace(/-?\d+(?:\.\d+)?::/gu, "")
        .replace(/::/gu, "")
        .replace(/[\r\n]+/gu, " ")
        .replace(/[{}\[\]]/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
}

let tokenizerPromise: Promise<{
    (text: string): {input_ids: {data: ArrayLike<number>}};
}> | null = null;

/** 使用 chatu-8 同口径清洗后调用 Xenova/t5-small；结果明确是估算值而非 NovelAI 服务端计费量。 */
export async function estimateNovelAiTokens(prompt: string): Promise<number> {
    const normalized = normalizeNovelAiTokenText(prompt);
    if (normalized === "") return 0;
    if (!tokenizerPromise) {
        tokenizerPromise = import("@huggingface/transformers")
            .then(async ({AutoTokenizer}) => {
                const tokenizer = await AutoTokenizer.from_pretrained("Xenova/t5-small");
                return tokenizer as unknown as {
                    (text: string): {input_ids: {data: ArrayLike<number>}};
                };
            })
            .catch((error) => {
                tokenizerPromise = null;
                throw error;
            });
    }
    const tokenizer = await tokenizerPromise;
    const encoded = tokenizer(normalized);
    return encoded.input_ids.data.length;
}
