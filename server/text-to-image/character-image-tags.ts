import {z} from "zod";
import {
    CharacterVisualDirectWriteRequestSchema,
    type CharacterVisualDirectWriteErrorCode,
    type CharacterVisualDirectWriteResult,
} from "nbook/shared/text-to-image-character-direct-write";
import {
    CharacterVisualDirectWriteError,
    CharacterVisualDirectWriteService,
    type CharacterVisualDirectWriteRuntime,
} from "nbook/server/text-to-image/character-visual-direct-write.service";
import {createCharacterVisualDirectWriteRuntime} from "nbook/server/text-to-image/character-visual-direct-write.runtime";

export {CharacterVisualDirectWriteRequestSchema, CharacterVisualDirectWriteError};
export type {CharacterVisualDirectWriteErrorCode, CharacterVisualDirectWriteRuntime};

/** 角色视觉唯一公开编排入口：只接受带 source hash 与 idempotency key 的 direct request。 */
export async function generateCharacterVisualFiles(
    inputValue: z.input<typeof CharacterVisualDirectWriteRequestSchema>,
    runtime?: CharacterVisualDirectWriteRuntime,
): Promise<CharacterVisualDirectWriteResult> {
    const input = CharacterVisualDirectWriteRequestSchema.parse(inputValue);
    const activeRuntime = runtime ?? await createCharacterVisualDirectWriteRuntime(input.projectPath);
    return new CharacterVisualDirectWriteService(activeRuntime).generate(input);
}
