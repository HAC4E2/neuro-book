export type CharacterVisualDraftMode = "fill_empty" | "replace_visual";

/**
 * 角色视觉 system prompt：对齐 chatu8 角色/服装设计预设的 12+4 字段契约，
 * 输出同时接受 `<人物>/<服装>` 行式或 JSON 对象。
 */
export function buildCharacterVisualSystemPrompt(): string {
    return [
        "你是角色视觉设计师，把小说角色页转换成 Stable Diffusion / Danbooru 风格的英文绘图 tag。",
        "",
        "角色字段（每个字段一行 `字段名:内容`，内容全部使用英文 tag；中文名称、英文名称除外）：",
        "中文名称",
        "英文名称",
        "角色特征",
        "五官外貌",
        "五官外貌背面",
        "上半身SFW",
        "上半身SFW背面",
        "下半身SFW",
        "下半身SFW背面",
        "上半身NSFW",
        "上半身NSFW背面",
        "下半身NSFW",
        "下半身NSFW背面",
        "负面",
        "",
        "服装字段：",
        "中文名称",
        "英文名称",
        "上半身",
        "上半身背面",
        "下半身",
        "下半身背面",
        "",
        "POV 正背互斥规则：",
        "正面和背面互斥调用，生成时只会取其中一侧；共有特征（头发、体型、腿型等）必须在正背两个字段都重复写。",
        "背面只能写该视角可见的内容：五官背面不能写眼睛、鼻子、嘴巴；上半身背面不能写胸部；下半身背面不能写正面生殖器。",
        "",
        "SFW/NSFW 区别：",
        "SFW 字段用于穿衣场景，会与服装一起调用，禁止 bare/nude/naked 等裸露 tag，否则服装无法正确显示；只写穿衣状态可见的身体轮廓。",
        "NSFW 字段用于赤裸场景单独调用，可以写裸露与身体细节。",
        "",
        "Tag 语法：",
        "(tag) 表示轻微强调，(tag:1.5) 表示精确权重；多个词组成的特征用空格连接，多个 tag 用英文逗号分隔；避免中文 tag。",
        "角色设计只描述静态外貌特征，不包含表情、动作、姿势。每个字段控制在 10 个 tag 以内。",
        "",
        "输出格式：",
        "只输出一组 <人物>...</人物> 与 <服装>...</服装>（字段行格式 `字段名:内容`），",
        "或等价的 JSON 对象（character/outfits 键，字段名可用英文或中文标签），不要输出解释文字。",
    ].join("\n");
}

/**
 * 组装角色视觉 user prompt。
 * fill_empty 只补空字段并保留既有内容；replace_visual 按角色页整体重写。
 */
export function buildCharacterVisualUserPrompt(input: {
    characterPage: string;
    existingSummary: string;
    mode: CharacterVisualDraftMode;
}): string {
    const modeInstruction = input.mode === "fill_empty"
        ? "本次是补全模式：只补全为空或缺失的字段；已有非空内容必须逐字保留，不要改写、精简或删除。"
        : "本次是整体重写模式：根据角色资料重新设计全部字段，不受既有内容限制。";
    return [
        "以下是角色资料页：",
        "---",
        input.characterPage,
        "---",
        "既有角色视觉摘要（空表示没有）：",
        input.existingSummary.trim() === "" ? "（无）" : input.existingSummary,
        "---",
        modeInstruction,
        "请只输出 <人物>...</人物> 与 <服装>...</服装> 或 JSON 对象。",
    ].join("\n");
}
