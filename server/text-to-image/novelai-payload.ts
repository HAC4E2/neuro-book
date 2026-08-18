import {randomUUID} from "node:crypto";

export type NovelAiModelFamily = "nai45";

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

const NOVEL_AI_V45_MODELS = new Set([
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-curated",
]);

/** 只接受 V4.5 Full/Curated；旧模型在进入生成器前必须已规范化。 */
export function resolveNovelAiModelFamily(model: string): NovelAiModelFamily {
    if (!NOVEL_AI_V45_MODELS.has(model)) {
        throw new Error(`不支持的 NovelAI 模型：${model}；仅支持 NAI4.5 Full/Curated`);
    }
    return "nai45";
}

export function buildNovelAiReferencePayload(
    _family: NovelAiModelFamily,
    references: {vibe: NovelAiResolvedVibe[]; character: NovelAiResolvedCharacter[]},
): Record<string, unknown> {
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

    validateNovelAiPayload("nai45", {
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

export function validateNovelAiPayload(_family: NovelAiModelFamily, payload: Record<string, unknown>): void {
    for (const field of ["width", "height", "scale", "sampler", "steps", "seed"]) {
        if (payload[field] === undefined || payload[field] === null) {
            throw new Error(`NovelAI payload 缺少字段：${field}`);
        }
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
