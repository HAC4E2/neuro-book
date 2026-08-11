# 文生图图片交互调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让历史图片单击只查看生成信息，让正文 NovelAI 图片双击进入后处理。

**Architecture:** 正文继续通过 TipTap 的 `asset-action` 事件进入现有 `TextToImageAssetActionDialog`，仅将触发事件从长按改为 `dblclick`。历史图片区移除生成操作遮罩，新增独立只读详情 Dialog，直接展示 `TextToImageAssetDto` 中已保存的 Prompt 和模型参数。

**Tech Stack:** Vue 3 Composition API、TipTap `handleDOMEvents`、Nuxt/Vue Dialog、Vitest、Bun。

## Global Constraints

- 历史图片不提供 Tag 修改、Reroll、局部重绘或其他生成入口。
- 正文图片单击不打开后处理；只有双击 `alt="NovelAI 生成图片"` 的 Project 资产图片才触发后处理。
- 不改变资产 API、队列、NovelAI 请求体、正文 Markdown 格式或后处理完成后的正文替换逻辑。
- 现有工作区中与本任务无关的未提交改动不得暂存、覆盖或删除。

---

### Task 1: 正文图片改为双击进入后处理

**Files:**
- Modify: `app/components/markdown-studio/TipTapMarkdownEditor.vue:109-111,278-293,1054-1094`
- Test: `app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

**Interfaces:**
- Consumes: 现有图片筛选条件和 `TextToImageAssetActionTarget`。
- Produces: 现有 `(e: "asset-action", target)` 事件，事件负载和页面层处理不变。

- [ ] **Step 1: Write the failing contract test**

在 `image-interaction.contract.test.ts` 中读取 `TipTapMarkdownEditor.vue`，断言源码包含 `dblclick` 与 `emit("asset-action", {relativePath})`，并不包含 `assetPressTimer`、`startAssetPress`、`clearAssetPressTimer` 和 `setTimeout`。

```ts
const editor = await readFile(editorPath, "utf8");
expect(editor).toContain("dblclick");
expect(editor).toContain('emit("asset-action", {relativePath})');
expect(editor).not.toContain("assetPressTimer");
expect(editor).not.toContain("startAssetPress");
expect(editor).not.toContain("setTimeout");
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `bunx vitest run app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

Expected: FAIL because the editor still contains the long-press timer and no `dblclick` handler.

- [ ] **Step 3: Replace the editor long-press binding**

删除 `assetPressTimer`、起始坐标和长按函数；在 `editorProps.handleDOMEvents` 中增加：

```ts
dblclick: (_view, event) => {
    handleAssetDoubleClick(event as MouseEvent);
    return false;
},
```

将现有图片筛选逻辑提取为 `handleAssetDoubleClick(event: MouseEvent)`，保留只读模式、左键、图片 class、NovelAI alt 和 Project 相对路径检查，然后发送相同的 `asset-action` 事件。

- [ ] **Step 4: Run the contract test and verify it passes**

Run: `bunx vitest run app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

Expected: PASS，且正文事件仍只携带 `{relativePath}`。

### Task 2: 历史图片改为只读生成信息

**Files:**
- Modify: `app/components/novel-ide/text-to-image/TextToImageHistorySection.vue:15-110,250-340`
- Test: `app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

**Interfaces:**
- Consumes: `TextToImageAssetDto` 的 `prompt`、`negativePrompt`、`model`、`width`、`height`、`seed`、`sourceKind` 和 `createdAt`。
- Produces: 历史图片点击打开本组件内部的只读详情 Dialog，不调用生成 API。

- [ ] **Step 1: Extend the failing contract test**

读取 `TextToImageHistorySection.vue`，断言它包含图片点击处理和只读详情字段，且不包含长按计时器、`openTagEdit`、`reroll`、`openInpaint`、`@pointerdown="startPress` 和“长按可执行后处理”文案。

```ts
const history = await readFile(historyPath, "utf8");
expect(history).toContain("activeInfoAsset");
expect(history).toContain("asset.prompt");
expect(history).toContain("asset.negativePrompt");
expect(history).toContain("asset.model");
expect(history).not.toContain("pressTimer");
expect(history).not.toContain("openTagEdit");
expect(history).not.toContain("openInpaint");
expect(history).not.toContain("长按");
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `bunx vitest run app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

Expected: FAIL because the history component still opens a long-press action overlay.

- [ ] **Step 3: Replace history actions with the read-only Dialog**

删除历史组件中的操作菜单状态、长按计时器、Tag/Reroll/Inpaint 请求函数及对应 Dialog。新增：

```ts
const activeInfoAsset = ref<TextToImageAssetDto | null>(null);

function openAssetInfo(asset: TextToImageAssetDto): void {
    activeInfoAsset.value = asset;
}

function closeAssetInfo(): void {
    activeInfoAsset.value = null;
}
```

历史图片改为 `@click="openAssetInfo(asset)"`，并增加只读 Dialog，展示：

```vue
<p>正面 Prompt：{{ activeInfoAsset.prompt }}</p>
<p>负面 Prompt：{{ activeInfoAsset.negativePrompt || "（空）" }}</p>
<p>模型：{{ activeInfoAsset.model }}</p>
<p>尺寸：{{ activeInfoAsset.width }} × {{ activeInfoAsset.height }}</p>
<p>Seed：{{ activeInfoAsset.seed }}</p>
<p>来源：{{ activeInfoAsset.sourceKind }}</p>
<p>生成时间：{{ activeInfoAsset.createdAt }}</p>
```

Prompt 使用只读 `<textarea readonly>` 或可换行文本块，避免长 Prompt 溢出；Dialog 只提供关闭操作。

- [ ] **Step 4: Run the contract test and verify it passes**

Run: `bunx vitest run app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

Expected: PASS，历史图片区不再含任何后处理入口。

### Task 3: 文案、回归和类型检查

**Files:**
- Modify: `app/pages/index.vue:1119-1122`
- Modify: `app/components/novel-ide/text-to-image/TextToImageHistorySection.vue`
- Test: `app/components/novel-ide/text-to-image/image-interaction.contract.test.ts`

- [ ] **Step 1: Update user-facing comments and empty-state text**

将页面层“长按正文图片”注释改为“双击正文图片”，将历史图片空状态改为“暂无历史图片，点击图片可查看生成信息”。

- [ ] **Step 2: Run focused tests**

Run: `bunx vitest run app/components/novel-ide/text-to-image app/components/markdown-studio/tiptap server/text-to-image server/api/text-to-image`

Expected: all focused tests pass.

- [ ] **Step 3: Run typecheck and diff validation**

Run: `bun run typecheck`

Expected: exit code `0`.

Run: `git diff --check`

Expected: no whitespace errors; do not stage unrelated pre-existing changes.
