import {z} from "zod";

/** 角色视觉 12 字段；全部为纯文本 tag，LLM 正文生图时直接读取。 */
export const CharacterVisualFieldSchema = z.object({
    cnName: z.string().default(""),
    enName: z.string().default(""),
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

/** 服装视觉 4 字段。 */
export const OutfitVisualSchema = z.object({
    cnName: z.string().default(""),
    enName: z.string().default(""),
    upper: z.string().default(""),
    upperBack: z.string().default(""),
    lower: z.string().default(""),
    lowerBack: z.string().default(""),
});
export type OutfitVisual = z.infer<typeof OutfitVisualSchema>;

/** `visual.json` 文件真相源。 */
export const CharacterVisualFileSchema = z.object({
    schema: z.literal("nbook.character-visual/v1"),
    characterId: z.string().trim().min(1),
    character: CharacterVisualFieldSchema,
    outfits: z.array(OutfitVisualSchema).default([]),
    photos: z.array(z.string()).default([]),
}).strict();
export type CharacterVisualFile = z.infer<typeof CharacterVisualFileSchema>;

/** 解析 visual.json 文本；格式不合法时抛 ZodError。 */
export function parseCharacterVisualJson(text: string): CharacterVisualFile {
    return CharacterVisualFileSchema.parse(JSON.parse(text) as unknown);
}

/** 规范渲染 visual.json 文本。 */
export function renderCharacterVisualJson(input: CharacterVisualFile): string {
    const parsed = CharacterVisualFileSchema.parse(input);
    return `${JSON.stringify(parsed, null, 2)}\n`;
}
