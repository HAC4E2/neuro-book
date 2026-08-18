import {z} from "zod";

/** 角色视觉 15 字段；全部为纯文本 tag，LLM 正文生图时直接读取。 */
export const CharacterVisualFieldSchema = z.object({
    cnName: z.string().default(""),
    enName: z.string().default(""),
    /** 半角竖线 `|` 分隔的正文触发词；为空时正文扫描回退到中文名/英文名，回退结果不写回。 */
    triggerWords: z.string().default(""),
    profileTraits: z.string().default(""),
    facialAppearance: z.string().default(""),
    facialBack: z.string().default(""),
    upperSfw: z.string().default(""),
    upperBackSfw: z.string().default(""),
    lowerSfw: z.string().default(""),
    lowerBackSfw: z.string().default(""),
    upperNsfw: z.string().default(""),
    upperBackNsfw: z.string().default(""),
    lowerNsfw: z.string().default(""),
    lowerBackNsfw: z.string().default(""),
    negativePrompt: z.string().default(""),
});
export type CharacterVisualField = z.infer<typeof CharacterVisualFieldSchema>;

/** 服装视觉 6 字段。 */
export const OutfitVisualSchema = z.object({
    cnName: z.string().default(""),
    enName: z.string().default(""),
    upper: z.string().default(""),
    upperBack: z.string().default(""),
    lower: z.string().default(""),
    lowerBack: z.string().default(""),
});
export type OutfitVisual = z.infer<typeof OutfitVisualSchema>;

/** `visual.json` 文件真相源；visualId 是在 v1 文件合同上增加的稳定版本标识。 */
export const CharacterVisualFileSchema = z.object({
    schema: z.literal("nbook.character-visual/v1"),
    visualId: z.string().uuid().optional(),
    characterId: z.string().trim().min(1),
    character: CharacterVisualFieldSchema,
    outfits: z.array(OutfitVisualSchema).default([]),
    photos: z.array(z.string()).default([]),
}).strict();
export type CharacterVisualFile = z.infer<typeof CharacterVisualFileSchema>;

/** 解析 visual.json 文本；格式不合法时抛 ZodError。 */
export function parseCharacterVisualJson(text: string): CharacterVisualFile {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw === "object" && raw !== null && "schema" in raw && raw.schema === "nbook.character-visual/v2") {
        return CharacterVisualFileSchema.parse({...raw, schema: "nbook.character-visual/v1"});
    }
    return CharacterVisualFileSchema.parse(raw);
}

/** 规范渲染 visual.json 文本。 */
export function renderCharacterVisualJson(input: CharacterVisualFile): string {
    const parsed = CharacterVisualFileSchema.parse(input);
    return `${JSON.stringify(parsed, null, 2)}\n`;
}
