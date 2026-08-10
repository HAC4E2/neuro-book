// @vitest-environment jsdom
import {Editor} from "@tiptap/core";
import {MarkdownManager} from "@tiptap/markdown";
import {describe, expect, it, vi} from "vitest";
import {createMarkdownDialectExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-dialect-extensions";
import {TextToImagePrompt} from "nbook/app/components/markdown-studio/tiptap/TextToImagePrompt";
import {renderTextToImagePromptMarkdown, type TextToImagePromptPayload} from "nbook/shared/text-to-image-markdown";

const payload: TextToImagePromptPayload = {
    id: "tti-1",
    schema: "nbook.text-to-image-prompt/v1",
    prompt: "1girl, long black hair",
    negativePrompt: "blurry, lowres",
    anchor: "p_0001",
    title: "港口醒来",
    size: "832x1216",
    tagThink: "清晨港口",
};

function createManager(): MarkdownManager {
    return new MarkdownManager({
        extensions: [...createMarkdownDialectExtensions(), TextToImagePrompt],
    });
}

describe("TextToImagePrompt", () => {
    it("renderTextToImagePromptMarkdown 输出可被 Markdown parser 识别为 textToImagePrompt 节点", () => {
        const markdown = renderTextToImagePromptMarkdown(payload);
        const parsed = createManager().parse(markdown);

        expect(parsed.content?.[0]).toMatchObject({
            type: "textToImagePrompt",
            attrs: payload,
        });
    });

    it("Markdown 往返保持 canonical 占位符", () => {
        const manager = createManager();
        const markdown = renderTextToImagePromptMarkdown(payload);

        expect(manager.serialize(manager.parse(markdown))).toBe(markdown);
    });

    it("点击生成按钮调用 onGenerate 并携带 payload", () => {
        const onGenerate = vi.fn();
        const editor = new Editor({
            element: document.createElement("div"),
            content: renderTextToImagePromptMarkdown(payload),
            contentType: "markdown",
            extensions: [...createMarkdownDialectExtensions(), TextToImagePrompt.configure({onGenerate})],
        });

        const button = editor.view.dom.querySelector<HTMLButtonElement>(".nb-text-to-image-prompt-button");
        expect(button).not.toBeNull();
        button?.click();

        expect(onGenerate).toHaveBeenCalledWith(payload);

        editor.destroy();
    });

    it("生成 Promise 未完成时禁用按钮，失败后恢复为可重新生成", async () => {
        let rejectGeneration!: (reason?: unknown) => void;
        const onGenerate = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectGeneration = reject;
        }));
        const editor = new Editor({
            element: document.createElement("div"),
            content: renderTextToImagePromptMarkdown(payload),
            contentType: "markdown",
            extensions: [...createMarkdownDialectExtensions(), TextToImagePrompt.configure({onGenerate})],
        });

        const button = editor.view.dom.querySelector<HTMLButtonElement>(".nb-text-to-image-prompt-button");
        const status = editor.view.dom.querySelector<HTMLElement>(".nb-text-to-image-prompt-status");
        button?.click();
        expect(button?.disabled).toBe(true);
        expect(status?.textContent).toBe("排队或生成中");

        rejectGeneration(new Error("429"));
        await Promise.resolve();
        await Promise.resolve();
        expect(button?.disabled).toBe(false);
        expect(status?.textContent).toBe("待生成");

        editor.destroy();
    });
});
