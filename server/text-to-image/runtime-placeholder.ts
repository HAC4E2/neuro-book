/** LLM 运行时占位符上下文；所有字段缺省为空。 */
export type TextToImageRuntimePlaceholderContext = {
    body?: string;
    context?: string;
    worldBook?: string;
    userDemand?: string;
    characterList?: string;
    commonCharacterList?: string;
    outfitList?: string;
    currentCharacter?: string;
    currentOutfit?: string;
    variables?: Record<string, string>;
    worldVariables?: Record<string, string>;
};

/**
 * 解析 chatu8 对齐的运行时占位符：
 * - `{{正文}}` / `{{上下文}}` / `{{用户需求}}` / `{{世界书触发}}` 等正文占位符；
 * - `{{roll 1d6}}` / `{{roll d20}}` / `{{roll 100}}` 骰子；
 * - `{{getvar::name}}`、`{@getvar::name@}`、`{@setvar::name::value@}` 变量；
 * - `{@getworldvar::name@}` / `{@setworldvar::name::value@}` 在首版复用同一请求内变量表。
 */
export function resolveTextToImageRuntimePlaceholders(
    text: string,
    input: TextToImageRuntimePlaceholderContext = {},
): string {
    const variables: Record<string, string> = {...(input.variables ?? {})};
    const worldVariables: Record<string, string> = {...(input.worldVariables ?? {})};
    return resolveTextToImageRuntimePlaceholdersWithVariables(text, input, variables, worldVariables);
}

/** Resolve one message while preserving variable mutations for later messages in the same request. */
export function resolveTextToImageRuntimePlaceholdersWithVariables(
    text: string,
    input: TextToImageRuntimePlaceholderContext,
    variables: Record<string, string>,
    worldVariables: Record<string, string> = {},
): string {
    let result = text;

    result = result.replace(/\{@setvar::([^:@]+)::([\s\S]*?)@\}/gu, (match, name: string, value: string) => {
        variables[name.trim()] = value;
        return "";
    });
    result = result.replace(/\{@setworldvar::([^:@]+)::([\s\S]*?)@\}/gu, (match, name: string, value: string) => {
        worldVariables[name.trim()] = value;
        return "";
    });
    result = result.replace(/\{\{setvar::([^}:]+)::([\s\S]*?)\}\}/gu, (match, name: string, value: string) => {
        variables[name.trim()] = value;
        return "";
    });
    result = result.replace(/\{\{setworldvar::([^}:]+)::([\s\S]*?)\}\}/gu, (match, name: string, value: string) => {
        worldVariables[name.trim()] = value;
        return "";
    });
    result = result.replace(/\{@getvar::([^@]+)@\}/gu, (match, name: string) => variables[name.trim()] ?? "");
    result = result.replace(/\{@getworldvar::([^@]+)@\}/gu, (match, name: string) => worldVariables[name.trim()] ?? "");
    result = result.replace(/\{\{getvar::([^}]+)\}\}/gu, (match, name: string) => variables[name.trim()] ?? "");
    result = result.replace(/\{\{getworldvar::([^}]+)\}\}/gu, (match, name: string) => worldVariables[name.trim()] ?? "");

    const standardReplacements: Record<string, string> = {
        "{{正文}}": input.body ?? "",
        "{{上下文}}": input.context ?? "",
        "{{世界书触发}}": input.worldBook ?? "",
        "{{用户需求}}": input.userDemand ?? "",
        "{{角色启用列表}}": input.characterList ?? "",
        "{{通用角色启用列表}}": input.commonCharacterList ?? "",
        "{{通用服装启用列表}}": input.outfitList ?? "",
        "{{当前角色}}": input.currentCharacter ?? "",
        "{{当前服装}}": input.currentOutfit ?? "",
        "{{服装列表}}": input.outfitList ?? "",
    };
    for (const [placeholder, value] of Object.entries(standardReplacements)) {
        result = result.replaceAll(placeholder, value);
    }

    result = result.replace(
        /\{\{roll\s+(?:(\d+)d(\d+)|d(\d+)|(\d+))\s*\}\}/giu,
        (match: string, countText: string | undefined, sidesText: string | undefined, dSidesText: string | undefined, flatText: string | undefined) => {
            const count = countText ? Math.max(1, Number.parseInt(countText, 10) || 1) : 1;
            const sides = Number.parseInt(sidesText ?? dSidesText ?? flatText ?? "6", 10);
            if (!Number.isFinite(sides) || sides <= 0) {
                return match;
            }
            let total = 0;
            for (let index = 0; index < count; index += 1) {
                total += 1 + Math.floor(Math.random() * sides);
            }
            return String(total);
        },
    );

    return result;
}
