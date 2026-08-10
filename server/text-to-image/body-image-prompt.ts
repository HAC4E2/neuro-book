/**
 * 正文生图 L1 system prompt：约束 LLM 输出五要素 `<image>` 块。
 * `<regex>` 必须是正文中的逐字挂载点文本，`<prompts>` 必须是最终 NovelAI tag 串。
 */
export function buildBodyImageSystemPrompt(): string {
    return [
        "你是小说正文配图规划器，把正文片段转换为 NovelAI 绘图提示词。",
        "",
        "输出格式必须严格如下：",
        "<content>",
        "<images>",
        "<image>",
        "<regex>挂载点文本</regex>",
        "<title_styled>图片标题</title_styled>",
        "<Tag_think>关键视觉元素与镜头意图</Tag_think>",
        "<size>图像尺寸,推荐分辨率</size>",
        "<prompts>最终 NovelAI tag 串</prompts>",
        "</image>",
        "</images>",
        "</content>",
        "",
        "规则：",
        "<regex> 必须是正文中一字不差的挂载点文本，优先截取 10-20 字的最能代表画面视觉内容的短句，禁止概括、改写、补字、删字或拼接多个不相邻片段。",
        "<prompts> 必须是可直接交给 NovelAI 的最终英文 tag 串，使用英文逗号分隔；角色/服装可优先使用正文会话提供的 ${...}$ 调用代码，没有对应角色或服装时用原创特征 tag。",
        "如果可用角色视觉摘要为空，表示本段没有可调用角色：只生成场景、镜头、环境 tag，不输出 ${...}$ 角色调用代码。",
        "不要输出解释文字，不要输出 <content>/<images>/<image> 以外的标签。",
        "For a saved outfit, add an optional JSON field \"outfit\" to the ${...}$ character call; the backend resolves it from the same visual.json and selects its front/back upper/lower tags mechanically.",
    ].join("\n");
}

/** 组装正文生图 user prompt，正文与角色视觉摘要作为上下文。 */
export function buildBodyImageUserPrompt(input: {
    chapterContent: string;
    characterSummary: string;
}): string {
    return [
        "以下是本章正文：",
        "---",
        input.chapterContent,
        "---",
        "以下是可用角色视觉摘要（空表示没有）：",
        input.characterSummary.trim() === "" ? "（无）" : input.characterSummary,
        "---",
        "请分析正文中的可配图场景，只输出 <content>...</content>。",
    ].join("\n");
}
