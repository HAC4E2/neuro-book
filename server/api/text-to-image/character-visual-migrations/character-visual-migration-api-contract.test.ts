import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROUTES = [
    "scan.get.ts", "prepare.post.ts", "source-inspect.post.ts", "source-preview.post.ts", "source-prepare.post.ts", "director-prepare.post.ts",
    "snapshot.get.ts", "resolve.post.ts", "apply.post.ts", "resume.post.ts",
];

describe("Character visual migration API contract", () => {
    it("全部路由使用 shared strict DTO、当前用户与 Project-open 错误边界", async () => {
        for (const route of ROUTES) {
            const source = await fs.readFile(path.join(process.cwd(), "server/api/text-to-image/character-visual-migrations", route), "utf8");
            expect(source).toContain("requireCurrentUser");
            expect(source).toContain("withProjectNotOpenHttpError");
            expect(source).toContain("createCharacterVisualMigrationService");
            expect(source).toContain("CharacterVisualMigration");
            expect(source).not.toContain("localStorage");
            expect(source).not.toContain("tagData");
            expect(source).not.toContain("NovelAIConfig");
        }
    });

    it("角色详情生成端点只调用 illustration.director proposal，不接收独立 LLM 或直接文件写参数", async () => {
        const source = await fs.readFile(path.join(process.cwd(), "server/api/text-to-image/character-image-tags.post.ts"), "utf8");
        expect(source).toContain("generateCharacterVisualProposal");
        expect(source).toContain("CharacterVisualDirectorGenerateRequestSchema");
        expect(source).toContain("withProjectNotOpenHttpError");
        expect(source).not.toMatch(/providerId|taskPrompt|temperature|topP|maxTokens|writeWorkspaceTextFile/iu);
    });

    it("resolve 由服务端注入 actor/approval identity，apply 与 resume 不接收 Provider/Recipe 参数", async () => {
        const resolve = await fs.readFile(path.join(process.cwd(), "server/api/text-to-image/character-visual-migrations/resolve.post.ts"), "utf8");
        const apply = await fs.readFile(path.join(process.cwd(), "server/api/text-to-image/character-visual-migrations/apply.post.ts"), "utf8");
        const resume = await fs.readFile(path.join(process.cwd(), "server/api/text-to-image/character-visual-migrations/resume.post.ts"), "utf8");
        expect(resolve).toContain("approvalId");
        expect(resolve).toContain("actorId");
        for (const source of [apply, resume]) {
            expect(source).not.toMatch(/sampler|scheduler|guidance|smea|seed|recipeId|providerId/iu);
        }
    });
});
