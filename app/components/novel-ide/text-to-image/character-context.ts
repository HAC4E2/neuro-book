export type CharacterGenerationContext = {
    characterId: string;
    groupId: string | null;
    characterPage: string;
};

/**
 * 将当前 Project 中的角色 Markdown 路径转换为视觉 Tag 生成所需的身份上下文。
 * characterId 保留角色目录的原始名称，包含中文和 Unicode 标点，不做 ASCII slug 化。
 * 标准角色路径为 `lorebook/character/<characterId>/...`，分组角色路径为
 * `lorebook/character/<groupId>/<characterId>/...`。
 */
export function resolveCharacterGenerationContext(
    filePath: string,
    content: string,
): CharacterGenerationContext | null {
    const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments[0] !== "lorebook" || segments[1] !== "character" || segments.length < 4 || content.trim() === "") {
        return null;
    }

    const characterPath = segments.slice(2);
    if (characterPath.length === 2) {
        return {
            characterId: characterPath[0] ?? "",
            groupId: null,
            characterPage: content,
        };
    }
    return {
        characterId: characterPath[1] ?? "",
        groupId: characterPath[0] ?? null,
        characterPage: content,
    };
}
