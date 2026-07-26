# Windows Runtime Artifact File URL Implementation Plan

**Goal:** 修复 Windows Portable namespace 路径导致 Agent Profile runtime artifact 无法动态导入，并审计同类 file URL 边界。

## Task 1：TDD 复现

- Modify: `server/utils/runtime-artifact-import.test.ts`
- 使用 Windows `\\?\` 本地盘符路径导入真实临时 `.mjs`。
- 运行单文件测试，确认失败原因与产品日志一致。

## Task 2：统一路径边界

- Modify: `server/runtime/paths/file-path.ts`
- Modify: `server/runtime/paths/file-path.test.ts`
- Modify: `server/utils/runtime-artifact-import.ts`
- Modify: `server/runtime/app-sqlite-location.ts`
- 新增纯路径 helper；artifact import 和 SQLite 共同复用，普通/UNC 路径保持原语义。

## Task 3：同类问题审计与回归

- 审计所有服务端 `pathToFileURL` / 动态 import 调用。
- 运行 runtime artifact、file path、SQLite、Runtime Paths、Profile artifact/catalog 相关测试和 typecheck。
- 仅修复确认会消费 State Root namespace 的边界，不改构建期路径。

## Task 4：构建、打包、真实验收

- 更新 Task walkthrough 与 `RELEASE.md`。
- 严格运行 `bun run nuxt:build`、`product:stage`、`desktop:tauri`、`desktop:assemble`。
- 用最终 EXE 请求真实 Agent Session 创建接口；验证不再出现 malformed file URL。
- 验证 Prisma、客户端边界、模型 API 快照、EXE 哈希和端口释放。
