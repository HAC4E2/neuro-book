import type {TextToImageNovelAiModel} from "nbook/shared/dto/text-to-image.dto";

export type NovelAiModelCapabilities = {
    family: "nai45" | "nai5";
    paramsVersion: 3 | 4;
    allowedSamplers: readonly string[];
    allowedNoiseSchedules: readonly string[];
    supportsVariety: boolean;
    varietySigmaFamily: "v4" | "v45" | null;
    supportsVibe: boolean;
    supportsCharacterReference: boolean;
    supportsInpaint: boolean;
    inpaintModel: string;
};

const NOVEL_AI_V45_SAMPLERS = [
    "k_euler",
    "ddim_v3",
    "k_dpmpp_2s_ancestral",
    "k_dpmpp_2m",
    "k_euler_ancestral",
    "k_dpmpp_2m_sde",
    "k_dpmpp_sde",
] as const;
const NOVEL_AI_NOISE_SCHEDULES = ["native", "exponential", "polyexponential", "karras"] as const;

/** NovelAI 模型能力唯一真相源；UI、规范化、payload 和验证器都从这里取值。 */
export const NOVEL_AI_MODEL_CAPABILITIES: Readonly<Record<TextToImageNovelAiModel, NovelAiModelCapabilities>> = {
    "nai-diffusion-4-5-full": {
        family: "nai45",
        paramsVersion: 3,
        allowedSamplers: NOVEL_AI_V45_SAMPLERS,
        allowedNoiseSchedules: NOVEL_AI_NOISE_SCHEDULES,
        supportsVariety: true,
        varietySigmaFamily: "v45",
        supportsVibe: true,
        supportsCharacterReference: true,
        supportsInpaint: true,
        inpaintModel: "nai-diffusion-4-5-full-inpainting",
    },
    "nai-diffusion-4-5-curated": {
        family: "nai45",
        paramsVersion: 3,
        allowedSamplers: NOVEL_AI_V45_SAMPLERS,
        allowedNoiseSchedules: NOVEL_AI_NOISE_SCHEDULES,
        supportsVariety: true,
        varietySigmaFamily: "v45",
        supportsVibe: true,
        supportsCharacterReference: true,
        supportsInpaint: true,
        inpaintModel: "nai-diffusion-4-5-curated-inpainting",
    },
    "nai-diffusion-5-full": {
        family: "nai5",
        paramsVersion: 4,
        allowedSamplers: NOVEL_AI_V45_SAMPLERS,
        allowedNoiseSchedules: NOVEL_AI_NOISE_SCHEDULES,
        supportsVariety: true,
        varietySigmaFamily: "v4",
        supportsVibe: false,
        supportsCharacterReference: false,
        supportsInpaint: true,
        inpaintModel: "nai-diffusion-5-full-inpainting",
    },
    "nai-diffusion-5-curated": {
        family: "nai5",
        paramsVersion: 4,
        allowedSamplers: NOVEL_AI_V45_SAMPLERS,
        allowedNoiseSchedules: NOVEL_AI_NOISE_SCHEDULES,
        supportsVariety: true,
        varietySigmaFamily: "v4",
        supportsVibe: false,
        supportsCharacterReference: false,
        supportsInpaint: true,
        inpaintModel: "nai-diffusion-4-5-curated-inpainting",
    },
};

export function getNovelAiModelCapabilities(model: string): NovelAiModelCapabilities | null {
    return NOVEL_AI_MODEL_CAPABILITIES[model as TextToImageNovelAiModel] ?? null;
}

export function requireNovelAiModelCapabilities(model: string): NovelAiModelCapabilities {
    const capabilities = getNovelAiModelCapabilities(model);
    if (!capabilities) {
        throw new Error(`不支持的 NovelAI 模型：${model}；仅支持 NAI V5/V4.5 Full/Curated`);
    }
    return capabilities;
}

export function resolveNovelAiDefaultSampler(model: string): string {
    const capabilities = requireNovelAiModelCapabilities(model);
    return capabilities.family === "nai5" ? "k_euler_ancestral" : "k_euler";
}

export function resolveNovelAiDefaultNoiseSchedule(model: string): string {
    const capabilities = requireNovelAiModelCapabilities(model);
    return capabilities.family === "nai5" ? "native" : "karras";
}

export function isNovelAiSamplerSupported(model: string, sampler: string): boolean {
    return getNovelAiModelCapabilities(model)?.allowedSamplers.includes(sampler) ?? false;
}

export function isNovelAiNoiseScheduleSupported(model: string, noiseSchedule: string): boolean {
    return getNovelAiModelCapabilities(model)?.allowedNoiseSchedules.includes(noiseSchedule) ?? false;
}

/** Variety 使用的 sigma 计算按能力表区分 V4.5 与 V5 的 chatu-8 路径。 */
export function calculateNovelAiVarietySigma(
    model: string,
    width: number,
    height: number,
): number | null {
    const family = getNovelAiModelCapabilities(model)?.varietySigmaFamily;
    if (family === null || family === undefined) return null;
    const area = (4 * (width / 8) * (height / 8)) / 63_232;
    const base = family === "v4" ? 58 : 58;
    return base * Math.sqrt(area);
}
