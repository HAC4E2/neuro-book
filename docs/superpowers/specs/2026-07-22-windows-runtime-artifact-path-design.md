# Windows Runtime Artifact File URL 修复设计

## 背景

Windows Portable 把 State Root 作为 `\\?\C:\...` namespace 路径传入运行时。文件系统复制和读取可以处理该路径，但 Node/Bun 的 `pathToFileURL()` 不能直接处理本地盘符 namespace；Agent Profile cache artifact 因此被转换成无效的 `file://%3F\C:\...`，导致 `POST /api/agent/sessions` 返回 500。

## 选定方案

在 Runtime Paths 的文件路径模块提供唯一的“移除 Windows 本地盘符 namespace”纯函数。运行时 artifact 在调用 `pathToFileURL()` 前使用该函数；SQLite 位置模块改为复用同一函数，删除重复实现。

保留 RuntimePaths 和真实文件系统操作中的 `\\?\`：namespace 对 Windows 长路径仍有价值。只在 file URL 边界转换，避免把修复扩大成全局路径语义变化。

## 未采用方案

- 全局从 RuntimePaths 移除 namespace：会改变所有文件系统调用并削弱长路径能力。
- 只在 Profile Catalog 局部替换字符串：Agent variables 和 World Engine 仍会在同一 artifact importer 中失败。
- 修改 Tauri/Manager 不再传 namespace：会改变部署协议且无法保护其他调用方传入的 namespace 路径。

## 审计范围

- `server/utils/runtime-artifact-import.ts`：Profile、Agent variables、World Engine runtime artifact 的统一导入边界。
- `server/runtime/app-sqlite-location.ts`：已有等价私有实现，迁移到统一 helper。
- 其余 `pathToFileURL()`：区分构建期固定源码路径、测试数据库路径和真实 State Root runtime 路径；只修改可能消费 namespace 的边界。

## 验证

- Windows 红灯：同一 `.mjs` 使用普通路径可导入，使用 `\\?\` 路径当前失败。
- 纯函数覆盖本地盘符 namespace、普通 Windows 路径、UNC/namespace UNC 和非 Windows 路径。
- runtime artifact、SQLite location、Runtime Paths、Profile Catalog/编译相关回归。
- 完整 typecheck 与 Nuxt/Nitro build；按 `nuxt:build -> product:stage -> Tauri -> assemble` 生成最终包。
- 最终 EXE 使用真实 `dist/data` 创建 Agent Session，确认接口非 500；同时验证模型快照、数据库迁移、客户端模块和端口清理。
