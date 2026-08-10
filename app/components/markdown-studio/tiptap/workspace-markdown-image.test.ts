import {describe, expect, it} from "vitest";
import {buildWorkspaceImageUrl, isWorkspaceImagePath} from "nbook/app/components/markdown-studio/tiptap/WorkspaceMarkdownImage";

describe("WorkspaceMarkdownImage", () => {
    it("识别文生图资产并生成带项目根的读取地址", () => {
        expect(isWorkspaceImagePath("assets/tti/image-1.png")).toBe(true);
        expect(isWorkspaceImagePath("https://example.com/image.png")).toBe(false);
        expect(buildWorkspaceImageUrl("demo-project", "assets/tti/中文 1.png")).toBe(
            "/api/text-to-image/assets/by-path/content?projectRoot=demo-project&relativePath=assets%2Ftti%2F%E4%B8%AD%E6%96%87%201.png",
        );
    });

    it("不把外部地址改写成 workspace API", () => {
        expect(isWorkspaceImagePath("/images/cover.png")).toBe(false);
        expect(isWorkspaceImagePath("data:image/png;base64,abc")).toBe(false);
    });
});
