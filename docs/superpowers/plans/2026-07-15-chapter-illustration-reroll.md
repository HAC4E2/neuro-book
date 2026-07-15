# 章节正文插图整体重 Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“正文生图”统一改为当前章节插图的事务式整体重规划：Agent 与 LLM 只读取清理后的正文，成功时原子替换旧受管引用与新占位符，失败时正文保持原样，历史图片资产继续保留。

**Architecture:** 以现有 `POST /api/text-to-image/body-prompts` 为唯一入口。`TextToImageAssetService` 提供当前章节可移除资产路径，shared Markdown 纯函数生成清理副本，`TextToImageBodyPromptService` 用同一副本完成角色识别、LLM、定位与编译，`TextToImageChapterService` 在文件锁内重新校验原始 hash，并以一次 tracked write 提交“清理后的正文 + 新占位符”。

**Tech Stack:** Nuxt 4、Vue 3、TypeScript、Nitro、Prisma、Marked、Zod、Vitest、Bun。

**Approved Design:** `docs/superpowers/specs/2026-07-15-chapter-illustration-reroll-design.md`，本计划不得静默改变其中的事务语义与资产保留边界。

## Global Constraints

- 当前工作区存在与本任务无关的未提交改动。每个任务只能暂存计划明确列出的文件，禁止使用 `git add -A`。
- 不删除 `TextToImageAsset` 数据或 `assets/text-to-image/**` 文件，只删除当前章节 Markdown 中受 NeuroBook 管理的引用。
- 不新增重 Roll API、队列类型或数据库迁移；继续使用现有正文生图入口和历史图片分页。
- 旧的 queued/running 正文生图任务不取消；旧占位符消失后，已有队列逻辑应将其写成 `sourceInsertStatus = "missing"`。
- Agent/LLM/定位/编译期间不持有章节文件锁；最终写入时仍以请求开始时的原始 hash 做乐观并发校验。
- `bun run typecheck` 在制定计划前基线通过。实现后的类型检查不得新增失败。
- 按仓库规则，本计划不自动执行浏览器验证；完成后只报告可选的人工或浏览器验收步骤。
- 所有新增导入使用 `nbook/...` 别名，不使用相对路径。

---

### Task 1: 建立受管正文生图 Markdown 清理契约

**Files:**
- Modify: `shared/text-to-image-markdown.ts`
- Modify: `shared/text-to-image-markdown.test.ts`

- [ ] **Step 1: 先写清理器失败测试**

在 `shared/text-to-image-markdown.test.ts` 保留现有渲染/解析测试，并新增以下导入：

```typescript
import {
    renderTextToImagePromptMarkdown,
    stripTextToImageManagedContent,
} from "nbook/shared/text-to-image-markdown";
```

新增一组测试，明确三条边界：仅移除合法占位符、仅移除白名单内的独立图片段落、代码块及普通图片保持字节内容不变。

```typescript
describe("stripTextToImageManagedContent", () => {
    const managedPath = "assets/text-to-image/project/chapter/body.webp";
    const otherChapterPath = "assets/text-to-image/project/other/body.webp";
    const prompt = renderTextToImagePromptMarkdown({
        id: "prompt-old",
        prompt: "1girl",
        negativePrompt: "lowres",
        characterIds: ["character-a"],
        sourceChapterHash: "a".repeat(64),
    });

    it("只移除当前章节受管图片和合法占位符", () => {
        const markdown = [
            "第一段正文。",
            `![NovelAI 生成图片](${managedPath} \"seed 1 | 832x1216\")`,
            prompt,
            "第二段正文。",
        ].join("\n\n");

        expect(stripTextToImageManagedContent(markdown, [managedPath])).toEqual({
            markdown: "第一段正文。\n\n第二段正文。",
            removedImageCount: 1,
            removedPromptCount: 1,
        });
    });

    it("保留手动图片、外链图片和其他章节资产", () => {
        const markdown = [
            "正文。",
            "![手动图片](images/manual.webp)",
            "![外链图片](https://example.com/remote.webp)",
            `![其他章节](${otherChapterPath})`,
        ].join("\n\n");

        expect(stripTextToImageManagedContent(markdown, [managedPath])).toEqual({
            markdown,
            removedImageCount: 0,
            removedPromptCount: 0,
        });
    });

    it("不把代码块内的标签或图片语法当作受管内容", () => {
        const markdown = [
            "```markdown",
            prompt,
            `![示例](${managedPath})`,
            "```",
        ].join("\n");

        expect(stripTextToImageManagedContent(markdown, [managedPath])).toEqual({
            markdown,
            removedImageCount: 0,
            removedPromptCount: 0,
        });
    });

    it("保留结构不合法的占位符", () => {
        const markdown = "<text-to-image-prompt id=\"broken\">\n{}\n</text-to-image-prompt>";
        expect(stripTextToImageManagedContent(markdown, [])).toEqual({
            markdown,
            removedImageCount: 0,
            removedPromptCount: 0,
        });
    });

    it("没有命中时逐字保留尾随空白", () => {
        const markdown = "正文。\n\n";
        expect(stripTextToImageManagedContent(markdown, [])).toEqual({
            markdown,
            removedImageCount: 0,
            removedPromptCount: 0,
        });
    });

    it("受管图片位于末尾时不留下多余分隔行", () => {
        const markdown = `正文。\n\n![NovelAI 生成图片](${managedPath})`;
        expect(stripTextToImageManagedContent(markdown, [managedPath])).toEqual({
            markdown: "正文。",
            removedImageCount: 1,
            removedPromptCount: 0,
        });
    });
});
```

- [ ] **Step 2: 运行测试并确认红灯原因是函数尚未实现**

Run:

```powershell
bun run test -- shared/text-to-image-markdown.test.ts
```

Expected: FAIL，TypeScript/Vitest 报告 `stripTextToImageManagedContent` 未导出或未定义；现有测试不应出现新的无关失败。

- [ ] **Step 3: 用 Marked 顶层 token 实现纯函数**

在 `shared/text-to-image-markdown.ts` 增加 Marked 导入与公开返回类型：

```typescript
import {marked, type Token, type Tokens} from "marked";

export type TextToImageManagedContentCleanup = {
    markdown: string;
    removedPromptCount: number;
    removedImageCount: number;
};
```

在现有解析函数之后增加以下实现。必须依赖 `parseTextToImagePromptMarkdown` 判断合法占位符，不能只按标签名称或正则前缀删除。

```typescript
/** 移除正文中明确归属于 NeuroBook 正文生图链路的块。 */
export function stripTextToImageManagedContent(
    markdown: string,
    removableAssetPaths: readonly string[],
): TextToImageManagedContentCleanup {
    const removablePaths = new Set(removableAssetPaths.map(normalizeAssetPath));
    let removedPromptCount = 0;
    let removedImageCount = 0;

    const tokens = marked.lexer(markdown);
    const keptTokens: Token[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        const managedPrompt = isManagedPromptToken(token);
        const managedImage = isManagedImageToken(token, removablePaths);
        if (!managedPrompt && !managedImage) {
            keptTokens.push(token);
            continue;
        }
        removedPromptCount += managedPrompt ? 1 : 0;
        removedImageCount += managedImage ? 1 : 0;

        if (tokens[index + 1]?.type === "space") {
            index += 1;
        } else if (index === tokens.length - 1 && keptTokens.at(-1)?.type === "space") {
            keptTokens.pop();
        }
    }

    return {
        markdown: keptTokens.map((token) => token.raw).join(""),
        removedPromptCount,
        removedImageCount,
    };
}

/** 仅识别可被现有严格解析器接受的顶层 HTML 占位符。 */
function isManagedPromptToken(token: Token): boolean {
    return token.type === "html" && parseTextToImagePromptMarkdown(token.raw) !== null;
}

/** 仅识别目标路径命中白名单的独立 Markdown 图片段落。 */
function isManagedImageToken(token: Token, removablePaths: ReadonlySet<string>): boolean {
    if (!isParagraphToken(token) || token.tokens.length !== 1) {
        return false;
    }
    const child = token.tokens[0];
    return child !== undefined
        && isImageToken(child)
        && removablePaths.has(normalizeAssetPath(child.href));
}

/** 收窄 Marked 的可扩展 token 联合类型。 */
function isParagraphToken(token: Token): token is Tokens.Paragraph {
    return token.type === "paragraph" && "tokens" in token && Array.isArray(token.tokens);
}

/** 收窄 Marked 图片 token，并拒绝扩展提供的同名畸形 token。 */
function isImageToken(token: Token): token is Tokens.Image {
    return token.type === "image" && "href" in token && typeof token.href === "string";
}

/** 将数据库路径和 Markdown destination 收敛为 Project-relative 斜杠格式。 */
function normalizeAssetPath(value: string): string {
    return value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/^\//u, "");
}
```

实现时先用当前 Marked 类型定义验证 `Token` 的收窄结果；如果 `marked.lexer` 返回类型要求 `TokensList`，只调整类型标注，不改成 `any` 或 `unknown`。不得对整篇 Markdown 调用 renderer，以免重排用户正文。

- [ ] **Step 4: 运行聚焦测试并修正空行边界**

Run:

```powershell
bun run test -- shared/text-to-image-markdown.test.ts
```

Expected: PASS；测试报告中该文件全部用例通过。未命中时返回值必须与输入逐字相同；命中时只消费被删除块后方的 `space` token，若被删除块位于文末则消费其前方分隔 token，不得全局 `trim` 或调用 renderer。

- [ ] **Step 5: 提交 Task 1**

```powershell
git add -- shared/text-to-image-markdown.ts shared/text-to-image-markdown.test.ts
git commit -m "feat(text-to-image): identify managed chapter content"
```

Expected: commit 只包含上述两个文件。

---

### Task 2: 查询当前章节可移除的正文生图资产路径

**Files:**
- Modify: `server/text-to-image/asset.service.ts`
- Modify: `server/text-to-image/asset.service.test.ts`

- [ ] **Step 1: 先写资产范围失败测试**

在 `server/text-to-image/asset.service.test.ts` 复用现有临时 Project Workspace、Prisma 和资产 fixture，新增以下用例：

```typescript
it("只列出当前章节 body 与 reroll 资产的 Project-relative 路径", async () => {
    const chapterPath = "manuscript/chapter-1.md";
    const otherChapterPath = "manuscript/chapter-2.md";
    const jobId = await createJob(projectPath);
    let seed = 100;
    const saveAsset = async (sourceKind: string, sourcePath: string) => await service.save({
        projectPath,
        jobId,
        bytes: new Uint8Array([137, 80, 78, 71]),
        mimeType: "image/png",
        width: 512,
        height: 768,
        model: "nai-diffusion-4-5-full",
        seed: seed += 1,
        prompt: "scene",
        negativePrompt: "",
        sourceKind,
        sourcePath,
        sourceAnchorId: "paragraph-1",
    });
    const body = await saveAsset("body", chapterPath);
    const reroll = await saveAsset("reroll", chapterPath);
    await saveAsset("manual", chapterPath);
    await saveAsset("body", otherChapterPath);

    await expect(service.listBodyAssetPaths(projectPath, chapterPath)).resolves.toEqual([
        body.relativePath,
        reroll.relativePath,
    ].sort());
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```powershell
bun run test -- server/text-to-image/asset.service.test.ts
```

Expected: FAIL，错误只指向 `listBodyAssetPaths` 尚不存在。

- [ ] **Step 3: 实现只读查询方法**

在 `TextToImageAssetService` 中新增公开方法，沿用该服务现有的 Project Workspace 规范化和 Prisma 获取方式：

```typescript
/** 返回当前章节可从 Markdown 移除的正文生图资产路径。 */
async listBodyAssetPaths(projectPath: string, chapterPath: string): Promise<string[]> {
    const client = await textToImageProjectClient(projectPath);
    const normalizedChapterPath = normalizeTextToImageSourcePath(chapterPath);
    const assets = await client.textToImageAsset.findMany({
        where: {
            sourcePath: normalizedChapterPath,
            sourceKind: {in: ["body", "reroll"]},
        },
        select: {relativePath: true},
        orderBy: {relativePath: "asc"},
    });
    return assets.map((asset) => normalizeTextToImageSourcePath(asset.relativePath));
}
```

在文件末尾增加同一规范化 helper：

```typescript
/** 统一数据库 sourcePath 与 Markdown 使用的 Project-relative 路径格式。 */
function normalizeTextToImageSourcePath(value: string): string {
    return value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}
```

查询必须同时约束当前 Project 数据库、`sourcePath` 与 `sourceKind`，不得从文件目录反向猜测资产归属。

- [ ] **Step 4: 运行资产测试**

Run:

```powershell
bun run test -- server/text-to-image/asset.service.test.ts
```

Expected: PASS；返回顺序稳定，并且 manual、character、其他章节资产均不在结果中。

- [ ] **Step 5: 提交 Task 2**

```powershell
git add -- server/text-to-image/asset.service.ts server/text-to-image/asset.service.test.ts
git commit -m "feat(text-to-image): scope body assets by chapter"
```

Expected: commit 只包含资产服务及其测试。

---

### Task 3: 将章节写入收敛为一次原子替换

**Files:**
- Modify: `server/text-to-image/chapter.service.ts`
- Modify: `server/text-to-image/chapter.service.test.ts`
- Modify: `server/text-to-image/queue.service.test.ts`

- [ ] **Step 1: 把现有插入测试迁移到替换语义并补齐失败保护**

在 `server/text-to-image/chapter.service.test.ts` 导入 `renderTextToImagePromptMarkdown`，将现有 `insertPrompts` 调用改为新的 `replacePrompts`。所有调用都显式传入 `removableAssetPaths`。

新增成功替换用例：

```typescript
it("在一次写入中移除旧受管内容并插入新占位符", async () => {
    const oldAssetPath = "assets/text-to-image/2026/07/old.png";
    const oldPrompt = renderTextToImagePromptMarkdown({
        id: "tti-old",
        prompt: "old prompt",
        negativePrompt: "",
        characterIds: [],
        sourceChapterHash: "a".repeat(64),
    });
    const original = [
        "第一段。",
        `![NovelAI 生成图片](${oldAssetPath} \"seed 1 | 832x1216\")`,
        oldPrompt,
        "![手动图片](images/manual.png)",
        "第二段。",
    ].join("\n\n");
    const chapterFile = path.join(resolveProjectAbsolutePath(projectPath), chapterPath);
    await fs.writeFile(chapterFile, original, "utf8");
    const snapshot = await service.snapshot(projectPath, chapterPath);
    const cleaned = "第一段。\n\n![手动图片](images/manual.png)\n\n第二段。";

    await expect(service.replacePrompts({
        projectPath,
        chapterPath,
        expectedHash: snapshot.hash,
        removableAssetPaths: [oldAssetPath],
        paragraphs: [{id: "p-1", start: 0, end: "第一段。".length, text: "第一段。"}],
        prompts: [{
            afterParagraphId: "p-1",
            payload: {
                id: "tti-new",
                prompt: "fresh prompt",
                negativePrompt: "",
                characterIds: [],
                sourceChapterHash: snapshot.hash,
            },
        }],
    })).resolves.toMatchObject({
        inserted: 1,
        skipped: 0,
        removedImages: 1,
        removedPrompts: 1,
    });

    const written = await fs.readFile(chapterFile, "utf8");
    expect(written).toContain("<text-to-image-prompt id=\"tti-new\">");
    expect(written).toContain("![手动图片](images/manual.png)");
    expect(written).not.toContain(oldAssetPath);
    expect(written).not.toContain("tti-old");
    expect(written.replace(/\n\n<text-to-image-prompt[\s\S]*?<\/text-to-image-prompt>/u, "")).toBe(cleaned);
});
```

新增“无有效新位置绝不提交清理结果”用例：

```typescript
it("没有有效新位置时完整保留旧正文", async () => {
    const oldAssetPath = "assets/text-to-image/2026/07/old.png";
    const original = `第一段。\n\n![NovelAI 生成图片](${oldAssetPath})`;
    const chapterFile = path.join(resolveProjectAbsolutePath(projectPath), chapterPath);
    await fs.writeFile(chapterFile, original, "utf8");
    const snapshot = await service.snapshot(projectPath, chapterPath);

    await expect(service.replacePrompts({
        projectPath,
        chapterPath,
        expectedHash: snapshot.hash,
        removableAssetPaths: [oldAssetPath],
        paragraphs: [{id: "p-1", start: 0, end: "第一段。".length, text: "错误段。"}],
        prompts: [{
            afterParagraphId: "p-1",
            payload: {
                id: "tti-new",
                prompt: "fresh prompt",
                negativePrompt: "",
                characterIds: [],
                sourceChapterHash: snapshot.hash,
            },
        }],
    })).resolves.toMatchObject({
        inserted: 0,
        skipped: 1,
        removedImages: 0,
        removedPrompts: 0,
    });
    await expect(fs.readFile(chapterFile, "utf8")).resolves.toBe(original);
});
```

同时修改“拒绝基于过期快照”用例，断言 `replacePrompts` 抛出 `TextToImageChapterConflictError`；保留并适配 `replacePrompt` 的回归用例，证明单图任务完成后的精确占位符替换仍可用。

在 `server/text-to-image/queue.service.test.ts` 增加旧任务回归用例，模拟整体重规划已经移除旧锚点：

```typescript
it("旧正文任务完成时锚点已消失仍保留资产并标记 missing", async () => {
    const replaceBodyPrompt = vi.fn(async () => "missing" as const);
    const service = new TextToImageQueueService({
        requestImages: async () => ({
            images: [{
                bytes: new Uint8Array([137, 80, 78, 71]),
                mimeType: "image/png",
                width: 832,
                height: 1216,
                seed: 1,
            }],
            request: {model: "nai-diffusion-4-5-full", seed: 1},
            warnings: [],
        }),
        resolveProvider: async () => ({
            credential: "secret",
            model: "nai-diffusion-4-5-full",
            requestIntervalMs: 0,
        }),
        saveAsset: async () => ({id: "asset-1", asset: assetDto()}),
        replaceBodyPrompt,
    });

    const job = await service.enqueue({
        projectPath,
        providerId: 9,
        kind: "body",
        prompt: "old scene",
        negativePrompt: "",
        novelAi: baseNovelAiInput(),
        sourcePath: "manuscript/chapter-1.md",
        sourceAnchorId: "tti-old",
    });

    await vi.waitFor(() => expect(replaceBodyPrompt).toHaveBeenCalledTimes(1));
    await expect(
        (await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}}),
    ).resolves.toMatchObject({
        status: "succeeded",
        sourceInsertStatus: "missing",
        resultAssetIdsJson: "[\"asset-1\"]",
    });
});
```

该测试只固定现有队列语义，不新增取消逻辑，也不修改 `queue.service.ts`。

- [ ] **Step 2: 运行章节测试并确认红灯**

Run:

```powershell
bun run test -- server/text-to-image/chapter.service.test.ts server/text-to-image/queue.service.test.ts
```

Expected: 整体命令 FAIL，失败集中在章节测试的 `replacePrompts` 尚未实现或返回字段缺失；新增队列 characterization 用例应直接 PASS。

- [ ] **Step 3: 实现带锁的整体替换方法并移除旧插入入口**

在 `server/text-to-image/chapter.service.ts` 导入 `stripTextToImageManagedContent`。把 `insertPrompts` 重命名为 `replacePrompts`，输入与返回类型改为：

```typescript
async replacePrompts(input: {
    projectPath: string;
    chapterPath: string;
    expectedHash: string;
    removableAssetPaths: readonly string[];
    paragraphs: TextToImageChapterParagraph[];
    prompts: Array<{afterParagraphId: string; payload: TextToImagePromptPayload}>;
}): Promise<{
    inserted: number;
    skipped: number;
    removedImages: number;
    removedPrompts: number;
    hash: string;
}>;
```

方法体必须在 `withLockedChapter` 回调内按以下顺序执行：

```typescript
return await this.withLockedChapter(input.projectPath, input.chapterPath, async (current, resolved) => {
    if (hashMarkdown(current) !== input.expectedHash) {
        throw new TextToImageChapterConflictError();
    }
    const cleanup = stripTextToImageManagedContent(current, input.removableAssetPaths);
    const paragraphs = new Map(input.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    const seenPromptIds = new Set<string>();
    const insertions: Array<{offset: number; markdown: string}> = [];
    let skipped = 0;

    for (const prompt of input.prompts) {
        const paragraph = paragraphs.get(prompt.afterParagraphId);
        if (
            !paragraph
            || seenPromptIds.has(prompt.payload.id)
            || cleanup.markdown.slice(paragraph.start, paragraph.end) !== paragraph.text
        ) {
            skipped += 1;
            continue;
        }
        seenPromptIds.add(prompt.payload.id);
        insertions.push({
            offset: paragraph.end,
            markdown: renderTextToImagePromptMarkdown(prompt.payload),
        });
    }

    if (insertions.length === 0) {
        return {
            inserted: 0,
            skipped,
            removedImages: 0,
            removedPrompts: 0,
            hash: hashMarkdown(current),
        };
    }

    let next = cleanup.markdown;
    for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
        next = `${next.slice(0, insertion.offset)}\n\n${insertion.markdown}${next.slice(insertion.offset)}`;
    }
    await writeResolvedProjectTextFileTracked({
        projectPath: input.projectPath,
        projectRoot: resolved.projectRoot,
        filePath: resolved.chapterPath,
        content: next,
        actor: USER_LOCAL_ACTOR,
        knownBefore: current,
    });
    return {
        inserted: insertions.length,
        skipped,
        removedImages: cleanup.removedImageCount,
        removedPrompts: cleanup.removedPromptCount,
        hash: hashMarkdown(next),
    };
});
```

不得先写入清理后的正文再插入占位符。不得保留 `insertPrompts` 兼容包装；同步修改仓库内唯一调用点，避免形成两套章节写入语义。

- [ ] **Step 4: 运行章节与 Markdown 聚焦回归**

Run:

```powershell
bun run test -- shared/text-to-image-markdown.test.ts server/text-to-image/chapter.service.test.ts server/text-to-image/queue.service.test.ts
```

Expected: PASS；成功替换、零有效位置、过期 hash、单占位符替换和旧队列锚点缺失全部通过。

- [ ] **Step 5: 提交 Task 3**

```powershell
git add -- server/text-to-image/chapter.service.ts server/text-to-image/chapter.service.test.ts server/text-to-image/queue.service.test.ts
git commit -m "feat(text-to-image): replace chapter illustration plan atomically"
```

Expected: commit 只包含章节服务、章节测试和队列 characterization 测试。

---

### Task 4: 让正文编排全链路消费同一份清理副本

**Files:**
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `server/text-to-image/body-prompt.service.ts`
- Create: `server/text-to-image/body-prompt.service.test.ts`

- [ ] **Step 1: 定义共享成功响应类型**

在 `shared/dto/text-to-image.dto.ts` 的正文生图相关 DTO 附近增加：

```typescript
export type TextToImageBodyPromptResponseDto = {
    inserted: number;
    skipped: number;
    removedImages: number;
    removedPrompts: number;
    promptIds: string[];
    warnings: string[];
};
```

该类型只描述已完成的一次正文规划请求；错误继续走现有 API error，不把失败状态混入成功 DTO。

- [ ] **Step 2: 先写编排服务失败测试与完整依赖工厂**

创建 `server/text-to-image/body-prompt.service.test.ts`。测试不得真实调用 Agent、LLM、Prisma 或磁盘；通过构造函数依赖注入观察各阶段输入。

先定义固定输入与依赖工厂：

```typescript
import {describe, expect, it, vi} from "vitest";
import {
    TextToImageBodyPromptService,
    type BodyPromptRequest,
    type TextToImageBodyPromptDependencies,
} from "nbook/server/text-to-image/body-prompt.service";

const chapterPath = "manuscript/chapter-1.md";
const originalHash = "a".repeat(64);
const managedPath = "assets/text-to-image/2026/07/old.png";
const cleanMarkdown = "第一段。\n\n第二段。";
const oldMarkdown = `第一段。\n\n![NovelAI 生成图片](${managedPath})\n\n第二段。`;

function request(): BodyPromptRequest {
    return {
        projectPath: "workspace/novel",
        chapterPath,
        chapterHash: originalHash,
        llmProviderId: 1,
        taskPrompt: "",
        defaultNegativePrompt: "lowres",
        promptRules: [],
        parameters: {temperature: 0.7, topP: 1, maxTokens: 4096},
    };
}

function dependencies(
    overrides: Partial<TextToImageBodyPromptDependencies> = {},
): TextToImageBodyPromptDependencies {
    const chapters = {
        snapshot: vi.fn(async () => ({
            projectPath: "workspace/novel",
            chapterPath,
            markdown: oldMarkdown,
            hash: originalHash,
        })),
        replacePrompts: vi.fn(async () => ({
            inserted: 1,
            skipped: 0,
            removedImages: 1,
            removedPrompts: 0,
            hash: "b".repeat(64),
        })),
    };
    return {
        chapters,
        assets: {listBodyAssetPaths: vi.fn(async () => [managedPath])},
        resolveCharacterContext: vi.fn(async () => ({
            matchedCharacters: [],
            detectorMatches: [],
            requestVariables: {},
            warnings: [],
        })),
        requestCompletion: vi.fn(async () => "<image>fresh composition</image>"),
        resolvePlacements: vi.fn(async (input) => ({
            placements: [{
                promptId: input.prompts[0]!.id,
                afterParagraphId: input.paragraphs[0]!.id,
                characterIds: [],
                view: "front",
                framing: "full",
                rating: "sfw",
                outfitName: "",
                reason: "开场",
                confidence: 0.9,
            }],
            warnings: [],
        })),
        compilePrompt: vi.fn(() => ({
            prompt: "fresh composition",
            negativePrompt: "lowres",
            characterPrompts: [],
            appliedRuleIds: [],
            warnings: [],
        })),
        ...overrides,
    };
}
```

如果 `Partial<TextToImageBodyPromptDependencies>` 的浅覆盖会替换整个 `chapters` 对象，测试需要覆盖章节方法时显式传入完整的 `{snapshot, replacePrompts}`，不要在工厂中加入深合并工具。

新增主流程测试：

```typescript
it("角色识别、LLM、定位和提交使用同一份清理后正文", async () => {
    const deps = dependencies();
    const service = new TextToImageBodyPromptService(deps);
    const result = await service.generate(request(), {
        baseUrl: "https://llm.example.com/v1",
        credential: "secret",
        allowPrivateNetwork: false,
        model: "gpt-test",
    });

    expect(deps.resolveCharacterContext).toHaveBeenCalledWith(expect.objectContaining({
        chapterMarkdown: cleanMarkdown,
    }));
    const completionInput = vi.mocked(deps.requestCompletion).mock.calls[0]![0];
    expect(completionInput.messages.at(-1)).toEqual({role: "user", content: cleanMarkdown});
    expect(deps.resolvePlacements).toHaveBeenCalledWith(expect.objectContaining({
        chapterMarkdown: cleanMarkdown,
    }));
    expect(deps.chapters.replacePrompts).toHaveBeenCalledWith(expect.objectContaining({
        expectedHash: originalHash,
        removableAssetPaths: [managedPath],
    }));
    expect(result).toMatchObject({
        inserted: 1,
        removedImages: 1,
        removedPrompts: 0,
    });
});
```

新增两个失败保护测试：

```typescript
it("LLM 没有返回有效 image 块时不提交清理副本", async () => {
    const deps = dependencies({requestCompletion: vi.fn(async () => "没有插图建议")});
    const service = new TextToImageBodyPromptService(deps);

    await expect(service.generate(request(), {
        baseUrl: "https://llm.example.com/v1",
        credential: "secret",
        allowPrivateNetwork: false,
        model: "gpt-test",
    })).resolves.toMatchObject({
        inserted: 0,
        removedImages: 0,
        removedPrompts: 0,
    });
    expect(deps.chapters.replacePrompts).not.toHaveBeenCalled();
});

it("定位器没有有效位置时不提交清理副本", async () => {
    const deps = dependencies({
        resolvePlacements: vi.fn(async () => ({placements: [], warnings: []})),
    });
    const service = new TextToImageBodyPromptService(deps);

    await expect(service.generate(request(), {
        baseUrl: "https://llm.example.com/v1",
        credential: "secret",
        allowPrivateNetwork: false,
        model: "gpt-test",
    })).resolves.toMatchObject({
        inserted: 0,
        removedImages: 0,
        removedPrompts: 0,
    });
    expect(deps.chapters.replacePrompts).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 运行新测试并确认红灯**

Run:

```powershell
bun run test -- server/text-to-image/body-prompt.service.test.ts
```

Expected: FAIL，原因是服务尚未导出依赖类型、尚未接受完整依赖对象，或尚未返回移除统计。

- [ ] **Step 4: 为编排服务加入显式依赖并切换到清理副本**

在 `server/text-to-image/body-prompt.service.ts` 增加：

```typescript
import {TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {stripTextToImageManagedContent} from "nbook/shared/text-to-image-markdown";
import type {TextToImageBodyPromptResponseDto} from "nbook/shared/dto/text-to-image.dto";

export type TextToImageBodyPromptDependencies = {
    chapters: Pick<TextToImageChapterService, "snapshot" | "replacePrompts">;
    assets: Pick<TextToImageAssetService, "listBodyAssetPaths">;
    resolveCharacterContext: typeof resolveProjectBodyImageCharacterTagContext;
    requestCompletion: typeof requestTextToImageLlmCompletion;
    resolvePlacements: typeof resolveBodyImagePromptPlacements;
    compilePrompt: typeof compileTextToImagePrompt;
};
```

构造函数改为完整默认依赖：

```typescript
constructor(private readonly dependencies: TextToImageBodyPromptDependencies = {
    chapters: new TextToImageChapterService(),
    assets: new TextToImageAssetService(),
    resolveCharacterContext: resolveProjectBodyImageCharacterTagContext,
    requestCompletion: requestTextToImageLlmCompletion,
    resolvePlacements: resolveBodyImagePromptPlacements,
    compilePrompt: compileTextToImagePrompt,
}) {}
```

把 `generate` 返回类型改为 `Promise<TextToImageBodyPromptResponseDto>`，并在原始快照 hash 校验后立即建立清理副本：

```typescript
const removableAssetPaths = await this.dependencies.assets.listBodyAssetPaths(
    input.projectPath,
    input.chapterPath,
);
const cleanup = stripTextToImageManagedContent(snapshot.markdown, removableAssetPaths);
const chapterMarkdown = cleanup.markdown;
```

随后逐项替换调用：

- `resolveProjectBodyImageCharacterTagContext` -> `this.dependencies.resolveCharacterContext`，传 `chapterMarkdown`。
- `requestTextToImageLlmCompletion` -> `this.dependencies.requestCompletion`，`buildMessages` 的正文参数传 `chapterMarkdown`。
- `collectParagraphs(snapshot.markdown)` -> `collectParagraphs(chapterMarkdown)`。
- `resolveBodyImagePromptPlacements` -> `this.dependencies.resolvePlacements`，传 `chapterMarkdown`。
- `compileTextToImagePrompt` -> `this.dependencies.compilePrompt`。
- `this.chapters.insertPrompts` -> `this.dependencies.chapters.replacePrompts`，额外传 `removableAssetPaths`。

LLM 未返回有效 `<image>` 时必须使用零移除统计，因为此时尚未提交：

```typescript
if (prompts.length === 0) {
    return {
        inserted: 0,
        skipped: 0,
        removedImages: 0,
        removedPrompts: 0,
        promptIds: [],
        warnings: [
            ...characterContext.warnings,
            "LLM 回复中没有有效的 <image>...</image> 块。",
        ],
    };
}
```

用以下完整区段替换现有低置信度过滤、编译和章节写入逻辑：

```typescript
const acceptedPlacements = placement.placements.filter((item) => item.confidence >= 0.65);
const rejectedPlacements = placement.placements.length - acceptedPlacements.length;
const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
const compilerWarnings: string[] = [];
const compiledPrompts = acceptedPlacements.flatMap((item) => {
    const prompt = promptById.get(item.promptId);
    if (!prompt) {
        return [];
    }
    const compiled = this.dependencies.compilePrompt({
        basePrompt: prompt.prompt,
        baseNegativePrompt: input.defaultNegativePrompt,
        resolution: {
            promptId: prompt.id,
            afterParagraphId: item.afterParagraphId,
            characterIds: item.characterIds.length > 0
                ? item.characterIds
                : characterContext.matchedCharacters.map((character) => character.id),
            view: item.view,
            framing: item.framing,
            rating: item.rating,
            outfitName: item.outfitName,
            reason: item.reason,
            confidence: item.confidence,
        },
        characters: characterContext.matchedCharacters,
        promptRules: input.promptRules,
    });
    compilerWarnings.push(...compiled.warnings);
    return [{
        afterParagraphId: item.afterParagraphId,
        payload: {
            id: prompt.id,
            prompt: compiled.prompt,
            negativePrompt: compiled.negativePrompt,
            characterIds: compiled.characterPrompts.map((character) => character.characterId),
            sourceChapterHash: snapshot.hash,
        },
    }];
});
const warnings = [
    ...characterContext.warnings,
    ...placement.warnings,
    ...compilerWarnings,
    ...(rejectedPlacements > 0
        ? [`已跳过 ${rejectedPlacements} 个低于 0.65 置信度的插图定位结果。`]
        : []),
];
if (compiledPrompts.length === 0) {
    return {
        inserted: 0,
        skipped: 0,
        removedImages: 0,
        removedPrompts: 0,
        promptIds: [],
        warnings: [...warnings, "插图定位器没有返回可用插入位置，已保持正文不变。"],
    };
}
const result = await this.dependencies.chapters.replacePrompts({
    projectPath: input.projectPath,
    chapterPath: input.chapterPath,
    expectedHash: snapshot.hash,
    removableAssetPaths,
    paragraphs,
    prompts: compiledPrompts,
});
return {
    inserted: result.inserted,
    skipped: result.skipped,
    removedImages: result.removedImages,
    removedPrompts: result.removedPrompts,
    promptIds: compiledPrompts.map((prompt) => prompt.payload.id),
    warnings,
};
```

最终响应中的 `removedImages`、`removedPrompts`、`inserted`、`skipped` 必须取自章节服务的事务结果，不能使用内存清理阶段的预估计数。`promptIds` 取 `compiledPrompts` 中的 payload ID；若章节服务最终全部跳过，则移除统计仍为 0。

- [ ] **Step 5: 运行编排与章节聚焦测试**

Run:

```powershell
bun run test -- server/text-to-image/body-prompt.service.test.ts server/text-to-image/chapter.service.test.ts shared/text-to-image-markdown.test.ts
```

Expected: PASS；三类服务均通过，LLM 无结果和定位无结果时 `replacePrompts` 调用次数为 0。

- [ ] **Step 6: 提交 Task 4**

```powershell
git add -- shared/dto/text-to-image.dto.ts server/text-to-image/body-prompt.service.ts server/text-to-image/body-prompt.service.test.ts
git commit -m "feat(text-to-image): rerun body planning from clean chapter"
```

Expected: commit 只包含共享 DTO、编排服务及其测试。

---

### Task 5: 更新正文生图前端反馈契约

**Files:**
- Modify: `app/pages/index.vue`
- Create: `app/utils/text-to-image-body-reroll.contract.test.ts`

- [ ] **Step 1: 先写静态交互契约测试**

创建 `app/utils/text-to-image-body-reroll.contract.test.ts`：

```typescript
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const indexPagePath = fileURLToPath(new URL("../pages/index.vue", import.meta.url));

describe("正文生图整体重规划交互契约", () => {
    it("消费共享响应 DTO 并报告移除与新增统计", async () => {
        const source = await readFile(indexPagePath, "utf8");

        expect(source).toContain("TextToImageBodyPromptResponseDto");
        expect(source).toContain("$fetch<TextToImageBodyPromptResponseDto>");
        expect(source).toContain("本章插图已重新规划");
        expect(source).toContain("result.removedImages");
        expect(source).toContain("result.removedPrompts");
        expect(source).toContain("result.inserted");
        expect(source).toContain("result.skipped");
    });

    it("没有新位置时仍明确保持正文不变", async () => {
        const source = await readFile(indexPagePath, "utf8");
        expect(source).toContain("插图定位器没有返回可用插入位置，已保持正文不变。");
    });
});
```

- [ ] **Step 2: 运行契约测试并确认红灯**

Run:

```powershell
bun run test -- app/utils/text-to-image-body-reroll.contract.test.ts
```

Expected: FAIL，当前页面仍使用内联响应类型，且成功通知未包含整体重规划统计。

- [ ] **Step 3: 使用共享 DTO 并更新成功通知**

在 `app/pages/index.vue` 顶部增加：

```typescript
import type {TextToImageBodyPromptResponseDto} from "nbook/shared/dto/text-to-image.dto";
```

把正文生图请求改为：

```typescript
const result = await $fetch<TextToImageBodyPromptResponseDto>("/api/text-to-image/body-prompts", {
```

保留 `!result.inserted` 时“不刷新、正文不变”的分支。成功刷新磁盘内容后，用完整统计替换现有成功提示：

```typescript
const skippedText = result.skipped ? `，跳过 ${result.skipped} 个无效位置` : "";
notification.success(
    `本章插图已重新规划：移除 ${result.removedImages} 张旧图引用和 ${result.removedPrompts} 个旧占位符，插入 ${result.inserted} 个新生成图片按钮${skippedText}。`,
    {title: "正文生图"},
);
```

不新增确认 Dialog，不改按钮位置，也不把历史图片清理混入前端操作。

- [ ] **Step 4: 运行前端契约测试与类型检查**

Run:

```powershell
bun run test -- app/utils/text-to-image-body-reroll.contract.test.ts
bun run typecheck
```

Expected: 两条命令均退出码 0；页面对 API 成功响应不再声明内联匿名类型。

- [ ] **Step 5: 提交 Task 5**

```powershell
git add -- app/pages/index.vue app/utils/text-to-image-body-reroll.contract.test.ts
git commit -m "feat(text-to-image): report chapter reroll results"
```

Expected: commit 只包含页面和新交互契约测试。

---

### Task 6: 完成聚焦回归、任务文档与仓库状态更新

**Files:**
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`

- [ ] **Step 1: 运行完整的正文生图聚焦回归**

Run:

```powershell
bun run test -- shared/text-to-image-markdown.test.ts server/text-to-image/asset.service.test.ts server/text-to-image/chapter.service.test.ts server/text-to-image/queue.service.test.ts server/text-to-image/body-prompt.service.test.ts server/text-to-image/body-image-character-tags.test.ts server/text-to-image/body-image-prompt-placement.test.ts server/text-to-image/prompt-compiler.test.ts app/utils/text-to-image-body-reroll.contract.test.ts
```

Expected: 全部退出码 0。记录控制台实际报告的测试文件数、测试数和耗时，供 walkthrough 使用。

- [ ] **Step 2: 运行项目类型检查与补丁完整性检查**

Run:

```powershell
bun run typecheck
git diff --check
```

Expected: 两条命令均退出码 0。若类型检查出现与本任务无关、且基线中不存在的新失败，先定位引入源，不得把失败笼统标记为“历史问题”。

- [ ] **Step 3: 更新持续 walkthrough**

在 `docs/tasks/text-to-image-panel/README.md` 的现有正文生图章节追加本轮实际结果：

- “正文生图”现在总是从移除当前章节受管引用后的内存副本重跑角色识别、LLM 与定位。
- 只有至少一个新位置有效且原始章节 hash 未变时，才一次性提交清理与新占位符。
- 历史资产不删除；旧队列任务完成后若锚点消失，继续按 `missing` 处理。
- 写入 Task 6 Step 1 与 Step 2 的真实命令结果，不保留模板数字或待填文字。
- 写明没有自动执行浏览器验证，这是项目规则决定的验证范围，不描述为功能已通过人工 UI 验收。

- [ ] **Step 4: 更新仓库级状态**

在 `PROJECT-STATUS.md` 的文生图模块状态中记录事务式章节重规划能力和仍需人工验收的交互项。若旧 TODO 正是“再次正文生图时清理旧图并重走流程”，删除该 TODO；不要顺手调整其他模块状态。

- [ ] **Step 5: 复核计划验收条件与实际实现**

逐项确认：

```text
1. 首次正文生图仍能生成占位符。
2. 再次执行时，三个 Agent/LLM 阶段读取同一份清理副本。
3. 成功提交后只删除当前章节白名单内图片引用与合法占位符。
4. 手动图片、外链、其他章节图片引用保留。
5. LLM 无结果、定位无结果、编译异常、资产查询异常、hash 冲突均不写正文。
6. 资产记录和图片文件没有删除路径。
7. 无效位置不会被追加到章节末尾。
```

若实现结果与规格存在偏差，先修正代码或在 walkthrough 中明确报告并请求用户决策，不能静默缩减验收标准。

- [ ] **Step 6: 提交文档并检查最终提交范围**

```powershell
git add -- docs/tasks/text-to-image-panel/README.md PROJECT-STATUS.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(text-to-image): record transactional chapter reroll"
```

Expected: 暂存列表只有上述两份文档；提交成功后，本功能由六个小提交组成，工作区中原有无关改动仍保持原状。

## Completion Gate

只有以下条件全部满足，才可以向用户报告实现完成：

- Task 1-6 的 checkbox 均已逐项更新。
- 聚焦 Vitest 与 `bun run typecheck` 的最后一次实际输出均为成功。
- `git diff --check` 无空白错误。
- walkthrough 已记录实际结果、与计划的差异和未执行的浏览器验收。
- 未删除任何历史图片文件或资产记录。
- 未暂存或提交开始任务前已存在的无关工作区改动。
