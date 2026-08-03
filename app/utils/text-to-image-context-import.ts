import {
    TextToImageContextEntrySchema,
    TextToImageContextProfileSchema,
    type TextToImageContextProfile,
} from "nbook/shared/dto/text-to-image.dto";

/** 兼容本应用导出格式与 chatu8 `预设名 -> {entries}` 格式。 */
export function normalizeImportedContextProfiles(parsed: unknown): Record<string, TextToImageContextProfile> {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("预设 JSON 顶层必须是对象");
    }
    const result: Record<string, TextToImageContextProfile> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "object" || value === null) continue;
        const raw = value as Record<string, unknown>;
        const entries = Array.isArray(raw.entries) ? raw.entries : [];
        const profile = TextToImageContextProfileSchema.parse({
            id: typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : key,
            name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : key,
            entries: entries.map((entry, index) => {
                if (typeof entry !== "object" || entry === null) {
                    throw new Error(`预设「${key}」第 ${index + 1} 条不是对象`);
                }
                const rawEntry = entry as Record<string, unknown>;
                return TextToImageContextEntrySchema.parse({
                    ...rawEntry,
                    id: typeof rawEntry.id === "string" && rawEntry.id.trim() !== ""
                        ? rawEntry.id
                        : `${key}-${index + 1}`,
                    name: typeof rawEntry.name === "string" ? rawEntry.name : "",
                });
            }),
        });
        result[profile.id] = profile;
    }
    if (Object.keys(result).length === 0) {
        throw new Error("没有可导入的上下文预设");
    }
    return result;
}
