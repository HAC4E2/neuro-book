# 自定义 Data 目录（安装时选路径 + 主界面切换）

> Active task。分支 `text-to-picture`。

## Relative documents refs

- `src-tauri/src/desktop.rs`：桌面启动编排，data 路径定位在此硬编码
- `src-tauri/Cargo.toml`：已有 serde / serde_json / junction / command-group
- `scripts/deploy/neuro-book-setup.iss`：Inno Setup 安装脚本
- `scripts/deploy/build-setup.mjs`：安装包自动化构建
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`：设置入口
- `server/api/config/*`：全局 config API（dataDir 不放这里，见 Decisions）

## User Request / Topic

- 安装 NeuroBook 时让用户选 data 文件夹位置（不想默认占 C 盘）
- 在 NeuroBook 主界面能改 data 文件夹目录（运行时切换 + 迁移数据）

## Goal

/goal 让 desktop.exe 启动时从 `{exe}/neuro-book.config.json` 读取 `dataDir` 定位 data 目录，ISS 安装时提供路径选择页写入该配置，前端设置项可改 `dataDir` 并在重启后自动迁移旧数据到新位置，verified by 端到端：安装选 D 盘路径→启动数据落在 D 盘；主界面改路径→重启迁移成功→数据完整可用。while preserving 现有便携版（不读 config 时回退 `root/data`）与现有启动/迁移/联接逻辑不回归。Use desktop.rs / tauri.conf.json / .iss / 前端设置组件。Between iterations 先装 Rust 编译基线，再改 Rust，再 ISS，最后前端。If Rust 工具链因网络无法安装，stop 并报告阻塞点。

## Current State

- desktop.rs `data_dir = root.join("data")` 硬编码，无外部配置入口
- ISS 安装包不打包 data，首次启动建空 data + 默认 config.json
- 未安装 Rust 工具链（cargo/rustc 不可用，tauri-cli 仅 JS 包装层）

## Decisions / Discussion

### config 文件位置：`{exe}/neuro-book.config.json`
dataDir 定位**先于** Nitro 服务启动。而 Nitro 的 `config.json` 本身在 `data/workspace/.nbook/` 下——若把 dataDir 存进 config.json 就是鸡生蛋。所以 data 目录配置必须放 exe 同目录的独立文件 `neuro-book.config.json`，由 desktop.rs 在启动 Nitro 前读取。

### config schema
```json
{
  "dataDir": "D:/NeuroBook/data",        // 当前生效 data 目录绝对路径；空/缺省→root/data
  "pendingMove": {                        // 待执行迁移（前端改 dataDir 时写入，重启时执行）
    "from": "C:/.../data",
    "to": "D:/NeuroBook/data"
  },
  "lastError": null                        // 迁移失败时写入，供前端展示
}
```

### 前端改配置通道：Tauri command（非 Nitro API）
前端跑在 Nitro 服务里，无法直接写 exe 目录文件。dataDir 变更需要：
1. Tauri command `change_data_dir(path)`：校验→写 pendingMove→relaunch
2. desktop.exe 重启→boot 检测 pendingMove→迁移→更新 dataDir→清 pending→启动服务

前端用 `@tauri-apps/api` invoke，需检测 Tauri 环境（`window.__TAURI_INTERNALS__`），非桌面环境降级隐藏该设置项。

### 迁移策略（启动时执行，服务未起，安全）
- pendingMove.to 必须不存在或为空（防覆盖）
- 校验 to 所在盘可用空间 >= from 体积
- 递归复制 from→to（data 无 junction，纯文件，可整树复制）
- 复制成功：data_dir=to，更新 config.dataDir=to，清 pendingMove。**不自动删 from**，提示用户旧目录可手动清理（防丢数据）
- 复制失败：删 to 部分副本，保留 from，config.lastError 写错误，仍用 from 启动，加载页展示错误
- 大数据迁移（GB 级）耗时，加载页轮询迁移进度

### 重启机制
Tauri 2 提供 `app.handle().restart()`（同进程 relaunch）。change_data_dir command 写完 pendingMove 后调用 restart，desktop.exe 重新 boot 执行迁移。

## Implementation Walkthrough

- [x] 1. 装 Rust 工具链（rustup 已存在于 ~/.cargo/bin，cargo/rustc 1.96.0）
- [x] 2. desktop.rs：DesktopConfig + read/write_desktop_config + resolve_data_dir（回退 root/data）+ strip BOM 兼容
- [x] 3. desktop.rs：pendingMove 迁移逻辑（migrate_data_dir + copy_dir_recursive）+ boot 集成 + 迁移进度 state
- [x] 4. desktop.rs + tauri.conf.json：新增 Tauri command get_data_dir / change_data_dir / get_migration_progress（withGlobalTauri=true，前端用 window.__TAURI__.core.invoke，无需 capabilities）
- [x] 5. 重新编译 exe，cargo build --release 通过（1分30秒）
- [x] 6. ISS：安装时自定义 data 路径选择页（TInputDirWizardPage）+ PostInstall 用 SaveStringsToUTF8File 写 neuro-book.config.json
- [x] 7. 前端：useDesktopBridge composable（isDesktop + getDataDir/changeDataDir/getMigrationProgress）
- [x] 8. 前端：DesktopDataDirDialog.vue + NovelIdeSettingsDialog 顶部仅 isDesktop 入口横条
- [x] 9. 加载页 placeholder/index.html 加 get_migration_progress 轮询，迁移期间显示进度
- [x] 10. build-setup.mjs 改用 PowerShell Copy-Item 暂存（node fs.cp 受 MAX_PATH 限制）
- [x] 11. 端到端打包：setup.exe 106M 成功

## Verification / Test

- [x] 基线：cargo build --release 产出 exe（仅原有 dead_code 警告）
- [x] nuxt:build 通过（前端 DesktopDataDirDialog + useDesktopBridge 编译无错）
- [x] ISS [Code] 段编译通过（历经 TEncoding→TArrayOfStrings→array of string 修正，最终 SaveStringsToUTF8File）
- [x] setup.exe 编译成功 907s / 106M
- [ ] 运行时验证：安装选 D 盘路径→启动 data 落 D 盘（待用户验收）
- [ ] 运行时验证：主界面改路径→重启迁移成功→数据完整（待用户验收）
- [ ] 迁移失败回滚（目标非空/空间不足）待验收

## TODO / Follow-ups

- 目录选择器：当前用文本输入，后续加 tauri-plugin-dialog 的 open(directory) 提升体验
- 迁移进度粒度：当前仅文案，大数据迁移可加百分比
- 跨盘空间预校验：当前复制失败才回滚，可加目标盘可用空间预检
- build-setup.mjs 中 runCapture 调 ISCC 会累积压缩日志到内存，可改流式输出

## 2026-07-22：Windows Desktop Prisma 子进程环境变量冲突

- 现象：Desktop 外层 `prisma-migrate.mjs` 能解析明确传入的 SQLite URL，但 Bun 1.3.14 在 Windows spawn 第二层 `sqlite-migrate.mjs` 时，如果继承环境还存在大小写不同的 `database_url`，会把键归一为 `DATABASE_URL` 并保留旧值；旧值带 query 时命中 SQLite URL 门禁，启动中止。
- 根因通过最小 Bun spawn 实验确认：父进程环境对象同时包含正确 `DATABASE_URL` 与旧 `database_url` 时，子进程实际读到旧的 `file:C:/bad.sqlite?mode=ro`。
- 修复：`prisma-env.mjs` 提供唯一的 `prismaChildEnvironment()`，覆盖数据库变量前按大小写不敏感规则清除全部变体；`prisma-migrate.mjs` 和 `prisma-generate.mjs` 统一使用该入口，不放宽 SQLite URL 安全校验。
- 验证：回归测试 2/2 通过；向 staged Product 注入冲突变量后，在临时 State Root 成功执行全部 9 个 SQLite migration；最终 Desktop portable 重新组装到 `dist/neuro-book-desktop-x64`，保留原 `data/`。

## 2026-07-22：Windows namespace State Root 导致迁移二次解析失败

- 现象：上一轮环境变量大小写去重后，真实 Desktop EXE 仍在第二层 `sqlite-migrate.mjs` 报“SQLite DATABASE_URL 不支持 query 或 fragment”。
- 真实复现：仅对 portable 运行副本加入临时诊断，确认子进程收到 `file://?/C:/Users/.../data/workspace/.nbook/neuro-book.sqlite`；诊断行随后撤除。
- 根因：Windows `current_exe()` 可能返回 `\\?\C:\...` namespace 路径。`resolveAppSqliteLocation()` 原先直接把反斜杠替换为 `/`，把 namespace 前缀错误序列化为 `file://?/C:/...`；第一次解析生成该值，第二次解析把 namespace 中的 `?` 误判为 query。
- 系统性修复：在 App SQLite 的公共位置解析边界规范化本地盘符 namespace State Root，再进行路径约束与 file URL 生成；没有在 Rust 启动器或迁移脚本局部绕过，UNC 禁止规则保持不变。
- 回归约束：新增 Windows namespace State Root 连续解析测试，要求连接 URL 稳定为 `file:C:/...`。TDD 红灯准确命中原 query/fragment 错误，修复后 SQLite Location 与打包聚焦组合共 18 项通过、1 项平台跳过。
- 最终验证：`bun run nuxt:build` 与 `bun run product:stage` 成功；portable 重新组装到 `dist/neuro-book-desktop-x64` 并保留既有 `data/`。对最终 `dist/product` 使用 portable Bun 1.3.14、`\\?\C:\...\data` State Root 和 Desktop 同款 `DATABASE_URL` 执行 `prisma-migrate.mjs --deploy`，返回 `FINAL_DIST_MIGRATION_EXIT=0`；完成前聚焦回归仍为 4 文件通过、18 项通过、1 项平台跳过。
