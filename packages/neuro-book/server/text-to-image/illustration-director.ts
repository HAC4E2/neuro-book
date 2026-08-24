import type {TextToImageCharacterPrompt} from "nbook/shared/text-to-image-markdown";
import {
    assertCanonicalBodyPromptCalls,
    normalizeBodyPromptCalls,
    type BodyPromptRepair,
} from "nbook/server/text-to-image/body-prompt-call.codec";

export type IllustrationDirectorBlock = {
    prompts: string;
    prompt?: string;
    characterPrompts?: TextToImageCharacterPrompt[];
};

export type IllustrationDirectorRepair = {
    imageIndex: number;
    slot: string;
    type: BodyPromptRepair["type"];
    count: number;
};

/** LLM 回复进入 L2 前的格式导演：只做可证明安全的分隔符修复并校验调用合同。 */
export class IllustrationDirector {
    normalize<T extends IllustrationDirectorBlock>(blocks: T[]): {
        blocks: T[];
        repairs: IllustrationDirectorRepair[];
    } {
        const repairs: IllustrationDirectorRepair[] = [];
        const normalized = blocks.map((block, imageIndex) => {
            try {
                const next = {...block};
                const normalizedPrompts = this.normalizeField(block.prompts, imageIndex, "prompts", repairs);
                next.prompts = normalizedPrompts;
                if (block.prompt !== undefined) {
                    next.prompt = this.normalizeField(block.prompt, imageIndex, "prompt", repairs);
                }
                if (block.characterPrompts !== undefined) {
                    next.characterPrompts = block.characterPrompts.map((characterPrompt, characterIndex) => ({
                        ...characterPrompt,
                        prompt: this.normalizeField(
                            characterPrompt.prompt,
                            imageIndex,
                            `character_${characterIndex + 1}.prompt`,
                            repairs,
                        ),
                        negativePrompt: this.normalizeField(
                            characterPrompt.negativePrompt,
                            imageIndex,
                            `character_${characterIndex + 1}.negativePrompt`,
                            repairs,
                        ),
                    }));
                }
                return next;
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(`图片 ${imageIndex + 1} 的角色调用格式无效：${reason}`);
            }
        });
        return {blocks: normalized, repairs};
    }

    /** 写入 L2 前的只读门禁；此处禁止再隐式修复。 */
    assertCanonical<T extends IllustrationDirectorBlock>(blocks: T[]): void {
        for (const [imageIndex, block] of blocks.entries()) {
            try {
                assertCanonicalBodyPromptCalls(block.prompts);
                if (block.prompt !== undefined) assertCanonicalBodyPromptCalls(block.prompt);
                for (const characterPrompt of block.characterPrompts ?? []) {
                    assertCanonicalBodyPromptCalls(characterPrompt.prompt);
                    assertCanonicalBodyPromptCalls(characterPrompt.negativePrompt);
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(`图片 ${imageIndex + 1} 未通过角色调用格式门禁：${reason}`);
            }
        }
    }

    private normalizeField(
        value: string,
        imageIndex: number,
        slot: string,
        repairs: IllustrationDirectorRepair[],
    ): string {
        const result = normalizeBodyPromptCalls(value);
        if (result.repairs.length > 0) {
            for (const repair of result.repairs) {
                const existing = repairs.find((item) => (
                    item.imageIndex === imageIndex + 1
                    && item.slot === slot
                    && item.type === repair.type
                ));
                if (existing) {
                    existing.count += 1;
                } else {
                    repairs.push({imageIndex: imageIndex + 1, slot, type: repair.type, count: 1});
                }
            }
        }
        assertCanonicalBodyPromptCalls(result.prompt);
        return result.prompt;
    }
}
