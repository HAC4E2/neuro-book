import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {buildCharacterReferenceTerms, normalizeTriggerToken} from "nbook/server/text-to-image/character-trigger-words";
import type {CharacterVisualFile, OutfitVisual} from "nbook/server/text-to-image/character-visual.codec";
import {
    parseBodyPromptCode,
    parseLegacyBodyPromptCode,
    scanBodyPromptCalls,
    type BodyPromptCall,
    type BodyPromptCode,
    type BodyPromptFacing,
    type BodyPromptKind,
} from "nbook/server/text-to-image/body-prompt-call.codec";

export type BodyPromptCompileErrorCode = "call_invalid" | "reference_missing" | "reference_ambiguous";

const BODY_PROMPT_ERROR_STATUS: Record<BodyPromptCompileErrorCode, number> = {
    call_invalid: 422,
    reference_missing: 409,
    reference_ambiguous: 409,
};

/** 编译阶段的稳定业务错误；API 可据此返回不暴露堆栈的用户错误。 */
export class BodyPromptCompileError extends Error {
    readonly statusCode: number;

    constructor(readonly code: BodyPromptCompileErrorCode, message: string) {
        super(message);
        this.name = "BodyPromptCompileError";
        this.statusCode = BODY_PROMPT_ERROR_STATUS[code];
    }
}

export type CompiledBodyPrompt = {
    prompt: string;
    negativePrompt: string;
    warnings: string[];
};

type VisualCandidate = {
    characterId: string;
    groupId: string | null;
    visualId: string | null;
    visual: CharacterVisualFile;
    temporary: boolean;
};

type OutfitCandidate = VisualCandidate & {
    outfit: OutfitVisual;
};

type LastCharacterContext = {
    candidate: VisualCandidate;
    facing: BodyPromptFacing;
    angleText: string;
};

type CharacterCallResult = {
    kind: "character";
    visual: CharacterVisualFile;
    candidate: VisualCandidate;
    outfit: OutfitVisual | null;
};

type OutfitCallResult = {
    kind: "outfit";
    outfit: OutfitVisual;
    facing: BodyPromptFacing;
    warning?: string;
};

type ResolvedBodyPromptCall = CharacterCallResult | OutfitCallResult;

/**
 * 队列生成前展开正文占位符里的 `${...}$` 角色/服装调用代码。
 * 角色来源为当前 Project 有效 visual；无 angle 的调用在语义解析阶段区分角色与独立服装。
 */
export async function compileBodyPrompt(
    projectRoot: string,
    prompt: string,
    options: {temporaryCharacters?: CharacterVisualFile[]} = {},
): Promise<CompiledBodyPrompt> {
    const negativeParts: string[] = [];
    const warnings: string[] = [];
    const temporaryCharacters = options.temporaryCharacters ?? [];
    let lastCharacterContext: LastCharacterContext | null = null;
    let output = "";
    let cursor = 0;

    for (const call of scanBodyPromptCalls(prompt)) {
        const index = call.start;
        output += prompt.slice(cursor, index);
        const code = parseCall(call);
        const resolved = await resolveBodyPromptCall(
            projectRoot,
            code,
            temporaryCharacters,
            lastCharacterContext,
        );

        if (resolved.kind === "character") {
            validateCharacterBodyStates(code);
            output += buildCharacterTags(resolved.visual, resolved.outfit, code).join(", ");
            if ((resolved.visual.character.negativePrompt ?? "").trim() !== "") {
                negativeParts.push((resolved.visual.character.negativePrompt ?? "").trim());
            }
            lastCharacterContext = {
                candidate: resolved.candidate,
                facing: code.facing,
                angleText: code.angleText,
            };
        } else {
            validateOutfitBodyStates(code, code.inlineOutfit !== null);
            output += buildOutfitTags(resolved.outfit, {...code, facing: resolved.facing}).join(", ");
            if (resolved.warning) warnings.push(resolved.warning);
        }
        cursor = call.end;
    }
    output += prompt.slice(cursor);

    const residualCalls = scanBodyPromptCalls(output);
    if (residualCalls.length > 0) {
        throw new BodyPromptCompileError("call_invalid", "提示词展开后仍包含未展开的角色或服装调用");
    }

    return {
        prompt: output,
        negativePrompt: negativeParts.join(", "),
        warnings,
    };
}

/** Collect inline character DNA from a single prompt without touching project storage. */
export function extractTemporaryCharacterRegistry(prompt: string): CharacterVisualFile[] {
    const result: CharacterVisualFile[] = [];
    for (const call of scanBodyPromptCalls(prompt)) {
        if (call.kind !== "json") continue;
        try {
            const code = parseBodyPromptCode(call.raw);
            if (code.inlineCharacter === null) continue;
            const characterId = code.characterId ?? `temporary:${code.name}`;
            if (result.some((item) => item.characterId === characterId)) continue;
            result.push({
                schema: "nbook.character-visual/v1",
                characterId,
                character: code.inlineCharacter,
                outfits: code.inlineOutfit ? [code.inlineOutfit] : [],
                photos: [],
            });
        } catch {
            // The normal compiler reports malformed calls with the source text.
        }
    }
    return result;
}

function parseCall(call: BodyPromptCall): BodyPromptCode {
    try {
        return call.kind === "json"
            ? parseBodyPromptCode(call.raw)
            : parseLegacyBodyPromptCode(call.raw);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BodyPromptCompileError("call_invalid", message);
    }
}

async function resolveBodyPromptCall(
    projectRoot: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
    lastCharacterContext: LastCharacterContext | null,
): Promise<ResolvedBodyPromptCall> {
    const classification = await classifyBodyPromptCall(
        projectRoot,
        code,
        temporaryCharacters,
        lastCharacterContext,
    );

    if (classification.kind === "character") {
        const resolved = await resolveCharacterVisual(
            projectRoot,
            code,
            temporaryCharacters,
            classification.candidate,
        );
        const outfit = await resolveAttachedOutfit(resolved.visual, code);
        return {
            kind: "character",
            visual: resolved.visual,
            candidate: resolved.candidate,
            outfit,
        };
    }

    const name = getStandaloneOutfitName(code);
    if (code.inlineOutfit !== null) {
        return {
            kind: "outfit",
            outfit: code.inlineOutfit,
            facing: resolveOutfitFacing(code, lastCharacterContext),
            warning: buildMissingCharacterContextWarning(name, code, lastCharacterContext),
        };
    }

    const resolved = await resolveStandaloneOutfit(
        projectRoot,
        name,
        code,
        temporaryCharacters,
        lastCharacterContext,
        classification.candidate,
    );
    return {
        kind: "outfit",
        outfit: resolved.outfit,
        facing: resolveOutfitFacing(code, lastCharacterContext),
        warning: buildMissingCharacterContextWarning(name, code, lastCharacterContext),
    };
}

async function classifyBodyPromptCall(
    projectRoot: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
    lastCharacterContext: LastCharacterContext | null,
): Promise<{kind: BodyPromptKind; candidate?: VisualCandidate | OutfitCandidate}> {
    if (code.kind === "character") {
        if (code.inlineOutfit !== null && code.inlineCharacter === null && code.name === "") {
            throw invalidCall("kind=character 需要角色 name 或 inline character");
        }
        return {kind: "character"};
    }
    if (code.kind === "outfit") {
        if (code.inlineCharacter !== null) {
            throw invalidCall("kind=outfit 不能同时包含 inline character");
        }
        if (code.inlineOutfit === null && getStandaloneOutfitName(code) === "") {
            throw invalidCall("kind=outfit 需要服装 name 或 inline outfit");
        }
        return {kind: "outfit"};
    }

    if (code.inlineCharacter !== null) return {kind: "character"};
    if (code.inlineOutfit !== null && code.name === "" && code.outfit === null) {
        return {kind: "outfit"};
    }
    if (code.angleText !== "") return {kind: "character"};

    const name = getStandaloneOutfitName(code);
    if (name === "") {
        throw invalidCall("无 angle 的调用需要 name 或 inline outfit");
    }
    const matches = await findReferenceMatches(
        projectRoot,
        name,
        code,
        temporaryCharacters,
        lastCharacterContext,
    );
    if (matches.characters.length > 0 && matches.outfits.length > 0) {
        throw ambiguousReference(
            `调用名“${name}”同时命中角色与服装，请增加 kind`,
        );
    }
    if (matches.characters.length > 1) {
        throw ambiguousReference(`角色“${name}”存在多个候选，请使用 characterId 或 groupId`);
    }
    if (matches.outfits.length > 1) {
        throw ambiguousReference(`独立服装“${name}”存在多个候选，请指定角色/视觉，或将调用放在对应角色调用之后`);
    }
    if (matches.characters.length === 1) {
        return {kind: "character", candidate: matches.characters[0]!};
    }
    if (matches.outfits.length === 1) {
        return {kind: "outfit", candidate: matches.outfits[0]!};
    }
    // 显式 characterId 是旧合同中的强定位；名称可能只是展示名的旧别名，
    // 此时交给 resolveCharacterVisual 按 ID 读取，不要求 name 再次精确命中。
    if (code.characterId !== null) return {kind: "character"};
    throw missingReference(`未找到角色或独立服装“${name}”`);
}

async function resolveCharacterVisual(
    projectRoot: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
    preferredCandidate?: VisualCandidate | OutfitCandidate,
): Promise<{visual: CharacterVisualFile; candidate: VisualCandidate}> {
    if (code.inlineCharacter !== null) {
        const visual: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: code.characterId ?? `temporary:${code.name}`,
            character: code.inlineCharacter,
            outfits: [],
            photos: [],
        };
        return {
            visual,
            candidate: {
                characterId: visual.characterId,
                groupId: code.groupId,
                visualId: code.visualId,
                visual,
                temporary: true,
            },
        };
    }

    const temporaryMatches = temporaryCharacters
        .map((item) => toTemporaryCandidate(item))
        .filter((item) => matchesCharacterName(item.visual, code.name));
    if (temporaryMatches.length > 1) {
        throw ambiguousReference(`临时角色“${code.name}”存在多个候选，请在调用中指定唯一名称`);
    }
    if (temporaryMatches.length === 1) {
        return {visual: temporaryMatches[0]!.visual, candidate: temporaryMatches[0]!};
    }

    if (preferredCandidate && "visual" in preferredCandidate) {
        return {visual: preferredCandidate.visual, candidate: preferredCandidate};
    }

    const library = new CharacterVisualLibraryService();
    if (code.characterId) {
        const groupId = code.groupId ?? "default";
        const visual = await library.read(projectRoot, {
            characterId: code.characterId,
            groupId,
            visualId: code.visualId ?? undefined,
        });
        if (visual === null) throw missingReference(`未找到角色“${code.name || code.characterId}”的 visual.json`);
        return {
            visual,
            candidate: {
                characterId: code.characterId,
                groupId,
                visualId: visual.visualId ?? code.visualId,
                visual,
                temporary: false,
            },
        };
    }

    const matches = (await collectProjectVisuals(projectRoot, code.groupId))
        .filter((item) => matchesCharacterName(item.visual, code.name));
    if (matches.length > 1) {
        throw ambiguousReference(`角色“${code.name}”存在多个候选，请使用 characterId 或 groupId`);
    }
    const candidate = matches[0];
    if (!candidate) throw missingReference(`未找到角色“${code.name}”的 visual.json`);
    if (code.visualId && candidate.visualId !== code.visualId) {
        const visual = await library.read(projectRoot, {
            characterId: candidate.characterId,
            groupId: candidate.groupId ?? "default",
            visualId: code.visualId,
        });
        if (!visual) throw missingReference(`未找到角色“${code.name}”的 visual.json`);
        return {
            visual,
            candidate: {...candidate, visualId: visual.visualId ?? code.visualId, visual},
        };
    }
    return {visual: candidate.visual, candidate};
}

async function resolveAttachedOutfit(
    visual: CharacterVisualFile,
    code: BodyPromptCode,
): Promise<OutfitVisual | null> {
    if (code.inlineOutfit !== null) return code.inlineOutfit;
    if (code.outfit === null) return null;
    const outfit = visual.outfits.find((item) => matchesOutfitName(item, code.outfit!));
    if (!outfit) {
        throw missingReference(`未找到角色“${code.name}”的服装“${code.outfit}”`);
    }
    return outfit;
}

async function resolveStandaloneOutfit(
    projectRoot: string,
    name: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
    lastCharacterContext: LastCharacterContext | null,
    preferredCandidate?: VisualCandidate | OutfitCandidate,
): Promise<{outfit: OutfitVisual; candidate: OutfitCandidate}> {
    if (preferredCandidate && "outfit" in preferredCandidate) {
        return {outfit: preferredCandidate.outfit, candidate: preferredCandidate};
    }
    const matches = await findReferenceMatches(
        projectRoot,
        name,
        code,
        temporaryCharacters,
        lastCharacterContext,
    );
    if (matches.outfits.length === 0) throw missingReference(`未找到独立服装“${name}”`);
    if (matches.outfits.length > 1) {
        throw ambiguousReference(`独立服装“${name}”存在多个候选，请指定角色/视觉，或将调用放在对应角色调用之后`);
    }
    return {outfit: matches.outfits[0]!.outfit, candidate: matches.outfits[0]!};
}

async function findReferenceMatches(
    projectRoot: string,
    name: string,
    code: BodyPromptCode,
    temporaryCharacters: CharacterVisualFile[],
    lastCharacterContext: LastCharacterContext | null,
): Promise<{characters: VisualCandidate[]; outfits: OutfitCandidate[]}> {
    const temporaryCandidates = temporaryCharacters.map((item) => toTemporaryCandidate(item));
    const candidates = [
        ...temporaryCandidates,
        ...(await collectProjectVisuals(projectRoot, code.groupId))
            .filter((item) => code.characterId === null || item.characterId === code.characterId)
            .filter((item) => code.visualId === null || item.visualId === code.visualId),
    ];
    // Prompt 内联视觉是本次请求的精确快照；命中时沿用旧合同的临时资料优先级，
    // 不让同名 Project visual 把这次请求解析成歧义。
    const baseCandidates = hasReferenceMatch(temporaryCandidates, name) ? temporaryCandidates : candidates;
    const contextCandidates = lastCharacterContext && code.characterId === null && code.groupId === null && code.visualId === null
        ? baseCandidates.filter((item) => sameVisual(item, lastCharacterContext.candidate))
        : [];
    const scopedCandidates = hasReferenceMatch(contextCandidates, name) ? contextCandidates : baseCandidates;
    const characters = scopedCandidates.filter((item) => matchesCharacterName(item.visual, name));
    const outfits = scopedCandidates.flatMap((item) => item.visual.outfits
        .filter((outfit) => matchesOutfitName(outfit, name))
        .map((outfit) => ({...item, outfit})));
    return {characters, outfits};
}

function hasReferenceMatch(candidates: VisualCandidate[], name: string): boolean {
    return candidates.some((item) => matchesCharacterName(item.visual, name) || item.visual.outfits.some((outfit) => matchesOutfitName(outfit, name)));
}

function toTemporaryCandidate(visual: CharacterVisualFile): VisualCandidate {
    return {
        characterId: visual.characterId,
        groupId: null,
        visualId: visual.visualId ?? null,
        visual,
        temporary: true,
    };
}

async function collectProjectVisuals(
    projectRoot: string,
    groupId?: string | null,
): Promise<Array<{characterId: string; groupId: string | null; visualId: string | null; visual: CharacterVisualFile; temporary: false}>> {
    const library = new CharacterVisualLibraryService();
    if (!groupId) {
        return (await library.getEffectiveVisuals(projectRoot)).map((item) => ({
            characterId: item.characterId,
            groupId: item.groupId,
            visualId: item.visualId,
            visual: item.visual,
            temporary: false as const,
        }));
    }
    const result: Array<{characterId: string; groupId: string | null; visualId: string | null; visual: CharacterVisualFile; temporary: false}> = [];
    for (const character of await library.listCharacters(projectRoot, groupId)) {
        const active = character.files.find((file) => file.active) ?? character.files[0];
        if (!active) continue;
        const visual = await library.read(projectRoot, {
            groupId,
            characterId: character.characterId,
            visualId: active.visualId,
        });
        if (visual) result.push({
            characterId: character.characterId,
            groupId,
            visualId: active.visualId,
            visual,
            temporary: false,
        });
    }
    return result;
}

function buildCharacterTags(
    visual: CharacterVisualFile,
    outfit: OutfitVisual | null,
    code: BodyPromptCode,
): string[] {
    const character = visual.character;
    const tags = [
        code.angleText,
        character.enName || character.cnName,
        character.profileTraits,
        code.facing === "back" ? character.facialBack : character.facialAppearance,
    ].filter((tag) => tag.trim() !== "");

    if (code.upperBody !== "hidden") {
        const upper = code.facing === "back"
            ? (code.upperBody === "nsfw" ? character.upperBackNsfw : character.upperBackSfw)
            : (code.upperBody === "nsfw" ? character.upperNsfw : character.upperSfw);
        if (upper.trim() !== "") tags.push(upper);
        const outfitUpper = code.facing === "back" ? outfit?.upperBack : outfit?.upper;
        if (outfitUpper?.trim()) tags.push(outfitUpper);
    }
    if (code.lowerBody !== "hidden") {
        const lower = code.facing === "back"
            ? (code.lowerBody === "nsfw" ? character.lowerBackNsfw : character.lowerBackSfw)
            : (code.lowerBody === "nsfw" ? character.lowerNsfw : character.lowerSfw);
        if (lower.trim() !== "") tags.push(lower);
        const outfitLower = code.facing === "back" ? outfit?.lowerBack : outfit?.lower;
        if (outfitLower?.trim()) tags.push(outfitLower);
    }
    return tags;
}

function buildOutfitTags(outfit: OutfitVisual, code: BodyPromptCode): string[] {
    const tags: string[] = [];
    if (code.upperBody !== "hidden") {
        const upper = code.facing === "back" ? outfit.upperBack : outfit.upper;
        if (upper.trim() !== "") tags.push(upper);
    }
    if (code.lowerBody !== "hidden") {
        const lower = code.facing === "back" ? outfit.lowerBack : outfit.lower;
        if (lower.trim() !== "") tags.push(lower);
    }
    return tags;
}

function validateCharacterBodyStates(code: BodyPromptCode): void {
    if (!isCharacterBodyState(code.upperBody) || !isCharacterBodyState(code.lowerBody)) {
        throw invalidCall("角色调用的 upperBody/lowerBody 只允许 sfw、nsfw 或 hidden");
    }
}

function validateOutfitBodyStates(code: BodyPromptCode, isInline: boolean): void {
    // 旧版 inline outfit 曾使用 sfw/nsfw；保留该已落盘格式，名称引用的独立服装严格使用 visible/hidden。
    const upperAllowed = isInline
        ? isCharacterBodyState(code.upperBody) || isOutfitBodyState(code.upperBody)
        : isOutfitBodyState(code.upperBody);
    const lowerAllowed = isInline
        ? isCharacterBodyState(code.lowerBody) || isOutfitBodyState(code.lowerBody)
        : isOutfitBodyState(code.lowerBody);
    if (!upperAllowed || !lowerAllowed) {
        throw invalidCall("独立服装调用的 upperBody/lowerBody 只允许 visible 或 hidden");
    }
}

function isCharacterBodyState(value: BodyPromptCode["upperBody"]): boolean {
    return value === "sfw" || value === "nsfw" || value === "hidden";
}

function isOutfitBodyState(value: BodyPromptCode["upperBody"]): boolean {
    return value === "visible" || value === "hidden";
}

function resolveOutfitFacing(code: BodyPromptCode, context: LastCharacterContext | null): BodyPromptFacing {
    return code.angleText === "" ? (context?.facing ?? "front") : code.facing;
}

function buildMissingCharacterContextWarning(
    name: string,
    code: BodyPromptCode,
    context: LastCharacterContext | null,
): string | undefined {
    if (code.angleText !== "" || context !== null || code.inlineOutfit !== null) return undefined;
    return `独立服装“${name}”没有前序角色调用，已使用正面素材`;
}

function getStandaloneOutfitName(code: BodyPromptCode): string {
    return code.name || code.outfit || "";
}

function matchesCharacterName(visual: CharacterVisualFile, name: string): boolean {
    const target = normalizeTriggerToken(name);
    return buildCharacterReferenceTerms(visual.character)
        .some((term) => normalizeTriggerToken(term) === target);
}

function matchesOutfitName(outfit: OutfitVisual, name: string): boolean {
    const target = normalizeTriggerToken(name);
    return [outfit.cnName, outfit.enName]
        .some((term) => normalizeTriggerToken(term) === target);
}

function sameVisual(left: VisualCandidate, right: VisualCandidate): boolean {
    if (left.temporary !== right.temporary) return false;
    if (left.visualId !== null && right.visualId !== null) return left.visualId === right.visualId;
    return left.characterId === right.characterId && left.groupId === right.groupId;
}

function invalidCall(message: string): BodyPromptCompileError {
    return new BodyPromptCompileError("call_invalid", message);
}

function missingReference(message: string): BodyPromptCompileError {
    return new BodyPromptCompileError("reference_missing", message);
}

function ambiguousReference(message: string): BodyPromptCompileError {
    return new BodyPromptCompileError("reference_ambiguous", message);
}
