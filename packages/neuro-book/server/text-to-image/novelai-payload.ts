import {randomUUID} from "node:crypto";
import {requireNovelAiModelCapabilities} from "nbook/shared/text-to-image-novelai-capabilities";

export type NovelAiModelFamily = "nai45" | "nai5";

export type NovelAiResolvedVibe = {
    encodingBase64: string;
    strength: number;
    informationExtracted: number;
};

export type NovelAiResolvedCharacter = {
    imageBase64: string;
    strength: number;
    informationExtracted: number;
};

/** 只接受 V5/V4.5 Full/Curated；旧模型在进入生成器前必须已规范化。 */
export function resolveNovelAiModelFamily(model: string): NovelAiModelFamily {
    return requireNovelAiModelCapabilities(model).family;
}

export function buildNovelAiReferencePayload(
    family: NovelAiModelFamily,
    references: {vibe: NovelAiResolvedVibe[]; character: NovelAiResolvedCharacter[]},
): Record<string, unknown> {
    if (family === "nai5" && references.vibe.length > 0) {
        throw new Error("当前 V5 模型不支持所选参数：Vibe Transfer");
    }
    if (family === "nai5" && references.character.length > 0) {
        throw new Error("当前 V5 模型不支持所选参数：角色参考图");
    }
    const payload: Record<string, unknown> = {};
    if (references.vibe.length > 0) {
        payload.reference_image_multiple_cached = references.vibe.map((item) => ({
            cache_secret_key: randomUUID(),
            data: item.encodingBase64,
        }));
        payload.reference_strength_multiple = references.vibe.map((item) => item.strength);
    }

    if (references.character.length > 0) {
        payload.director_reference_images_cached = references.character.map((item) => ({
            cache_secret_key: randomUUID(),
            data: item.imageBase64,
        }));
        payload.director_reference_descriptions = references.character.map(() => ({
            caption: {base_caption: "character", char_captions: []},
            legacy_uc: false,
        }));
        payload.director_reference_information_extracted = references.character.map((item) => item.informationExtracted);
        payload.director_reference_strength_values = references.character.map((item) => item.strength);
        payload.director_reference_secondary_strength_values = references.character.map((item) => Number((1 - item.strength).toFixed(6)));
    }

    validateNovelAiPayload(family, {
        width: 1,
        height: 1,
        scale: 1,
        sampler: "",
        steps: 1,
        seed: 0,
        ...payload,
    });
    return payload;
}

export function validateNovelAiPayload(family: NovelAiModelFamily, payload: Record<string, unknown>): void {
    for (const field of ["width", "height", "scale", "sampler", "steps", "seed"]) {
        if (payload[field] === undefined || payload[field] === null) {
            throw new Error(`NovelAI payload 缺少字段：${field}`);
        }
    }
    if (family === "nai5" && [
        "reference_image_multiple_cached",
        "reference_strength_multiple",
        "director_reference_images_cached",
        "director_reference_descriptions",
        "director_reference_information_extracted",
        "director_reference_strength_values",
        "director_reference_secondary_strength_values",
    ].some((field) => payload[field] !== undefined)) {
        throw new Error("当前 V5 模型不支持所选参数：Vibe Transfer 或角色参考图");
    }
    assertEqualArrayLengths(payload, [
        "reference_image_multiple_cached",
        "reference_strength_multiple",
    ]);
    if (payload.reference_image_multiple !== undefined || payload.reference_information_extracted_multiple !== undefined) {
        throw new Error("NAI4.5 不支持 NAI3 Vibe 数组");
    }
    assertEqualArrayLengths(payload, [
        "director_reference_images_cached",
        "director_reference_descriptions",
        "director_reference_information_extracted",
        "director_reference_strength_values",
        "director_reference_secondary_strength_values",
    ]);
}

function assertEqualArrayLengths(payload: Record<string, unknown>, fields: string[]): void {
    const arrays = fields.map((field) => ({field, value: payload[field]})).filter(({value}) => value !== undefined);
    if (arrays.length === 0) return;
    const first = arrays[0];
    if (!first || !Array.isArray(first.value)) {
        throw new Error(`NovelAI payload 字段 ${first?.field ?? fields[0]} 必须是数组`);
    }
    for (const entry of arrays.slice(1)) {
        if (!Array.isArray(entry.value) || entry.value.length !== first.value.length) {
            throw new Error(`NovelAI payload 数组长度不匹配：${entry.field}`);
        }
    }
}
