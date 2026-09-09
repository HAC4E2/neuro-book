import {describe, expect, it} from "vitest";
import {TextToImageTailMessagesConfigSchema, TextToImageToolCallConfigSchema} from "nbook/shared/dto/text-to-image.dto";
import {
    exportTextToImageTailConfig,
    exportTextToImageToolConfig,
    parseTextToImageTailConfig,
    parseTextToImageToolConfig,
} from "nbook/app/utils/text-to-image-tool-config-import";

describe("text-to-image Tool/Tail file formats", () => {
    it("round-trips independent Tool and Tail envelopes without trimming text", () => {
        const tool = TextToImageToolCallConfigSchema.parse({desc: "  custom  ", fields: [{name: "answer", description: " d ", required: true, wrapTag: ""}]});
        const tail = TextToImageTailMessagesConfigSchema.parse({enabled: true, messages: [{role: "user", content: "  long\ntext  "}]});
        expect(parseTextToImageToolConfig(exportTextToImageToolConfig(tool))).toEqual(tool);
        expect(parseTextToImageTailConfig(exportTextToImageTailConfig(tail))).toEqual(tail);
        expect(parseTextToImageToolConfig(tool)).toEqual(tool);
        expect(parseTextToImageTailConfig(tail)).toEqual(tail);
    });

    it("rejects mismatched type/version envelopes", () => {
        expect(() => parseTextToImageToolConfig({type: "antigravity_tail_config", version: "1.0", data: {}})).toThrow();
        expect(() => parseTextToImageTailConfig({type: "antigravity_tail_config", version: "2.0", data: {}})).toThrow();
    });
});