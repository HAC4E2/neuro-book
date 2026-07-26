import {createHash} from "node:crypto";
import YAML from "yaml";
import {
    TextToImageRecipeSourceSchema,
    normalizeTextToImageRecipeSourceInput,
    type TextToImageRecipeSnapshot,
    type TextToImageRecipeSource,
} from "nbook/shared/text-to-image-recipe";
import {createWorkspaceContentFrontmatterDefaults} from "nbook/server/workspace-files/content-node-schema";
import {
    renderMarkdownDocument,
} from "nbook/server/workspace-files/workspace-files";

export const DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH = "lorebook/instruction/text-to-image/default/index.md";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/** 解析标准内容节点中的 strict Recipe 扩展。 */
export function parseTextToImageRecipeMarkdown(markdown: string): TextToImageRecipeSource {
    const match = markdown.match(FRONTMATTER_PATTERN);
    if (!match) {
        throw new Error("Recipe Markdown 缺少 frontmatter");
    }
    const document = YAML.parseDocument(match[1] ?? "", {
        logLevel: "silent",
        strict: true,
        uniqueKeys: true,
    });
    if (document.errors.length > 0) {
        throw new Error(`Recipe frontmatter 解析失败：${document.errors.map((error) => error.message).join("; ")}`);
    }
    const frontmatter: unknown = document.toJS();
    if (!isPlainObject(frontmatter)) {
        throw new Error("Recipe frontmatter 必须是对象");
    }
    if (frontmatter.type !== "instruction" || frontmatter.subtype !== "text-to-image-recipe") {
        throw new Error("Recipe 必须是 subtype=text-to-image-recipe 的 instruction 内容节点");
    }
    const ext = frontmatter.ext;
    if (!isPlainObject(ext) || !("textToImageRecipe" in ext)) {
        throw new Error("Recipe frontmatter 缺少 ext.textToImageRecipe");
    }
    return TextToImageRecipeSourceSchema.parse(normalizeTextToImageRecipeSourceInput(ext.textToImageRecipe));
}

/** 规范渲染 Project Recipe 内容节点；正文仅作人类说明，不参与执行 hash。 */
export function renderTextToImageRecipeMarkdown(input: TextToImageRecipeSource): string {
    const source = TextToImageRecipeSourceSchema.parse(input);
    const frontmatter = createWorkspaceContentFrontmatterDefaults({
        title: source.title,
        type: "instruction",
        status: "active",
    });
    frontmatter.subtype = "text-to-image-recipe";
    frontmatter.icon = "image";
    frontmatter.tags = ["文生图", "NovelAI", "Recipe"];
    frontmatter.summary = "NovelAI 模型、采样、尺寸、seed 与正负画风串的 Project 真相源。";
    frontmatter.retrieval = {enabled: false, trigger: null};
    frontmatter.governance = {source: "manual", review: "reviewed"};
    frontmatter.ext = {textToImageRecipe: source};
    return renderMarkdownDocument(frontmatter, [
        `# ${source.title}`,
        "",
        "本文件由文生图分页维护。执行时服务端解析 frontmatter，并冻结 RecipeSnapshot；正文不参与执行。",
        "",
    ].join("\n"));
}

/** 从规范化 source 生成两层稳定 hash 的不可变 RecipeSnapshot。 */
export function createTextToImageRecipeSnapshot(input: TextToImageRecipeSource): TextToImageRecipeSnapshot {
    const source = TextToImageRecipeSourceSchema.parse(input);
    const planningConstraintsHash = sha256({
        schemaVersion: source.schemaVersion,
        recipeId: source.recipeId,
        dimensions: source.dimensions,
    });
    return {
        ...source,
        planningConstraintsHash,
        recipeSourceHash: sha256(source),
    };
}

function sha256(value: object): string {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
