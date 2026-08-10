export type CharacterWorkbenchSectionId = "character" | "outfit" | "enabled";

export const characterWorkbenchSections = [
    {id: "character", label: "角色详情", icon: "i-lucide-user-round"},
    {id: "outfit", label: "服装详情", icon: "i-lucide-shirt"},
    {id: "enabled", label: "当前启用角色", icon: "i-lucide-badge-check"},
] as const satisfies ReadonlyArray<{
    id: CharacterWorkbenchSectionId;
    label: string;
    icon: string;
}>;

export type CharacterFieldKey =
    | "cnName"
    | "enName"
    | "triggerWords"
    | "profileTraits"
    | "facialAppearance"
    | "facialBack"
    | "upperSfw"
    | "upperBackSfw"
    | "lowerSfw"
    | "lowerBackSfw"
    | "upperNsfw"
    | "upperBackNsfw"
    | "lowerNsfw"
    | "lowerBackNsfw"
    | "negativePrompt";

export const characterDetailFieldGroups = [
    {
        id: "identity",
        title: "身份与触发",
        fields: ["cnName", "enName", "triggerWords", "profileTraits"],
    },
    {
        id: "face",
        title: "五官",
        fields: ["facialAppearance", "facialBack"],
    },
    {
        id: "sfw",
        title: "SFW 身体",
        fields: ["upperSfw", "upperBackSfw", "lowerSfw", "lowerBackSfw"],
    },
    {
        id: "nsfw",
        title: "NSFW 身体",
        fields: ["upperNsfw", "upperBackNsfw", "lowerNsfw", "lowerBackNsfw"],
    },
    {
        id: "negative",
        title: "负面 Tag",
        fields: ["negativePrompt"],
    },
] as const satisfies ReadonlyArray<{
    id: string;
    title: string;
    fields: readonly CharacterFieldKey[];
}>;

export const characterDetailFieldLabels: Record<CharacterFieldKey, string> = {
    cnName: "角色中文名",
    enName: "角色英文名",
    triggerWords: "触发词（逗号分隔）",
    profileTraits: "角色特征",
    facialAppearance: "五官正面",
    facialBack: "五官背面",
    upperSfw: "上半身 SFW 正面",
    upperBackSfw: "上半身 SFW 背面",
    lowerSfw: "下半身 SFW 正面",
    lowerBackSfw: "下半身 SFW 背面",
    upperNsfw: "上半身 NSFW 正面",
    upperBackNsfw: "上半身 NSFW 背面",
    lowerNsfw: "下半身 NSFW 正面",
    lowerBackNsfw: "下半身 NSFW 背面",
    negativePrompt: "负面 Tag",
};

export type OutfitFieldKey = "cnName" | "enName" | "upper" | "upperBack" | "lower" | "lowerBack";

export const outfitDetailFields = [
    {key: "cnName", label: "服装中文名"},
    {key: "enName", label: "服装英文名"},
    {key: "upper", label: "上半身正面"},
    {key: "upperBack", label: "上半身背面"},
    {key: "lower", label: "下半身正面"},
    {key: "lowerBack", label: "下半身背面"},
] as const satisfies ReadonlyArray<{key: OutfitFieldKey; label: string}>;
