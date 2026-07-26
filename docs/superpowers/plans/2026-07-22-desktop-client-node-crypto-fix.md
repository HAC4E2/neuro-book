# Desktop Client Node Crypto Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Windows Desktop 页面分块泄漏 `node:crypto` 导致的 500，并重新输出可启动的 `dist/neuro-book-desktop-x64/NeuroBook.exe`。

**Architecture:** 共享合同哈希改用浏览器与 Node 都支持的同步纯 TypeScript SHA-256，保持既有同步接口和哈希格式。Vite 不再 externalize `node:crypto`，完整客户端构建后由独立边界检查拒绝任何 `node:` 模块 specifier。

**Tech Stack:** Nuxt 4、Vue 3、TypeScript、Bun、Vitest、esbuild、`@noble/hashes`、Tauri/WebView2。

## Global Constraints

- 不改变 canonical JSON 语义、同步函数签名或 `sha256:<64 lowercase hex>` 格式。
- 不修改数据库、用户数据、Provider 配置或桌面 Rust 启动器。
- 新依赖使用 Bun 安装当前最新版本。
- Bun 命令在沙盒外执行。
- 最终产物必须输出到 `dist/neuro-book-desktop-x64`，组装时保留已有 `data/`。
- 用户没有要求 Git 提交；本计划不执行 `git add` 或 `git commit`。

---

### Task 1: 共享合同哈希浏览器兼容

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `shared/text-to-image-contract-hash.ts`
- Create: `shared/text-to-image-contract-hash.browser.test.ts`
- Modify: `nuxt.config.ts`

**Interfaces:**
- Consumes: `canonicalizeTextToImageContract(value): string`。
- Produces: 保持 `hashTextToImageContract(value): string` 同步接口与原输出格式。

- [ ] **Step 1: 写浏览器打包红灯测试**

测试使用 esbuild 的 `platform: "browser"` 和真实共享模块入口进行 bundle；旧实现应因 `node:crypto` 无法解析而失败。

```typescript
import path from "node:path";
import {describe, expect, it} from "vitest";
import {build} from "esbuild";

describe("text-to-image contract hash browser boundary", () => {
    it("bundles without Node built-in modules", async () => {
        const result = await build({
            entryPoints: [path.resolve("shared/text-to-image-contract-hash.ts")],
            bundle: true,
            format: "esm",
            platform: "browser",
            write: false,
            logLevel: "silent",
        });
        expect(result.outputFiles).toHaveLength(1);
    });
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `bunx vitest run shared/text-to-image-contract-hash.browser.test.ts`

Expected: FAIL，esbuild 明确报告浏览器平台不能解析 `node:crypto`。

- [ ] **Step 3: 安装跨运行时哈希依赖并实现最小修复**

Run: `bun add @noble/hashes@latest`

实现使用 `sha256`、`utf8ToBytes`、`bytesToHex` 对 canonical string 做同步 SHA-256；删除 `node:crypto` import。删除 `nuxt.config.ts` 中 `/node:crypto/` external，让以后误引 Node built-in 在构建期暴露。

- [ ] **Step 4: 运行绿灯与既有合同测试**

Run: `bunx vitest run shared/text-to-image-contract-hash.browser.test.ts shared/text-to-image-tag-resolution.test.ts shared/text-to-image-tag-pattern.test.ts`

Expected: 所有测试通过，哈希格式与既有合同断言保持不变。

### Task 2: 客户端产物运行时边界守卫

**Files:**
- Create: `scripts/build/assert-client-runtime-boundary.ts`
- Create: `scripts/build/assert-client-runtime-boundary.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `findNodeModuleSpecifiers(source: string): string[]`，返回静态 import/export 与动态 import 中的 `node:` specifier。
- Produces: `assertClientRuntimeBoundary(publicRoot?: string): Promise<void>`，递归扫描 `_nuxt/*.js`，发现违规时抛出包含文件和 specifier 的错误。

- [ ] **Step 1: 写 scanner 红灯测试**

用最小字符串 fixture 覆盖 `import "node:crypto"`、`import ... from "node:fs"`、`export ... from "node:path"`、`import("node:os")` 和普通浏览器相对 import；期望只返回四个 Node specifier。

- [ ] **Step 2: 运行红灯测试**

Run: `bunx vitest run scripts/build/assert-client-runtime-boundary.test.ts`

Expected: FAIL，因为 scanner 接口尚未实现。

- [ ] **Step 3: 实现 scanner 并接入 Nuxt build**

脚本只扫描 `.output/public/_nuxt/**/*.js`。`package.json` 的 `nuxt:build` 在 `nuxt build` 后、Nitro runtime patch 前执行 `bun scripts/build/assert-client-runtime-boundary.ts`。

- [ ] **Step 4: 运行 scanner 绿灯测试**

Run: `bunx vitest run scripts/build/assert-client-runtime-boundary.test.ts`

Expected: PASS。

### Task 3: 完整验证与 Desktop 重新组装

**Files:**
- Modify: `.planning/2026-07-22-windows-sqlite-path/task_plan.md`
- Modify: `.planning/2026-07-22-windows-sqlite-path/findings.md`
- Modify: `.planning/2026-07-22-windows-sqlite-path/progress.md`
- Modify: `docs/tasks/text-to-image-panel/README.md`（若现有任务 walkthrough 将本轮 Provider/客户端打包问题归入该任务）
- Modify: `PROJECT-STATUS.md`（仅当本轮改变仓库级风险或模块状态）
- Modify: `RELEASE.md`（按发布/打包流程记录用户可见修复与验证）

**Interfaces:**
- Consumes: `bun run nuxt:build` 生成的 `.output`。
- Produces: `dist/neuro-book-desktop-x64/NeuroBook.exe` 及相邻 Product payload。

- [ ] **Step 1: 运行聚焦测试与类型检查**

Run: `bunx vitest run shared/text-to-image-contract-hash.browser.test.ts scripts/build/assert-client-runtime-boundary.test.ts shared/text-to-image-tag-resolution.test.ts shared/text-to-image-tag-pattern.test.ts server/database/sqlite-location.test.ts`

Run: `bun run typecheck`

Expected: 0 failed；typecheck exit 0。

- [ ] **Step 2: 完整构建并检查浏览器产物**

Run: `bun run nuxt:build`

Expected: exit 0，边界守卫报告扫描通过；`.output/public/_nuxt` 不含 Node module specifier。

- [ ] **Step 3: 更新 walkthrough 与发布说明**

记录迁移修复、新 500 根因、代码边界修复、实际测试/构建证据，以及计划与实际偏差。

- [ ] **Step 4: Product stage 与 Desktop assemble**

Run: `bun run product:stage`

Run: `bun run desktop:assemble`

Expected: 两条命令 exit 0，最终 EXE 位于 `dist/neuro-book-desktop-x64/NeuroBook.exe`，portable `data/` 保留。

- [ ] **Step 5: 最终产物验证**

使用最终 portable Bun、最终 Product 和 Windows namespace State Root 执行 `prisma-migrate.mjs --deploy`，期望 exit 0。启动最终 EXE 后检查监听端口、根 HTML、入口 chunk 与页面 chunk；确认页面 chunk 不含 `node:` specifier，WebView 不再显示原始动态模块 500。
