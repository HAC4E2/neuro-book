# 130 - 桌面应用前置架构、发行载荷与存储生命周期

> 当前状态：Product Runtime Image、Runtime Contract、Storage/Locator 与 Product shutdown 的共享地基及 Windows Product 发行门禁已收口（2026-07-31，含发布前独立 Runtime 类型边界）。当前优先推荐 `Tauri Desktop Envelope + 独立 Bun Product`，但 Tauri/Electron 最终选择必须经过同一套 spike 验收后再冻结。

## Relative documents refs

- [Task 26 Windows Portable](../26-windows-portable-packaging/README.md)
- [Task 100 部署鉴权与源码携带](../100-deployment-auth-and-source-carry/README.md)
- [Task 105 统一安装目录与 Manager](../105-unified-installation-manager/README.md)
- [Task 117 Windows 进程树生命周期](../117-windows-process-tree-lifecycle/README.md)
- [Task 120 Agent Skill package contract](../120-agent-skill-package-contract/README.md)
- [Task 125 Runtime artifact 存储生命周期](../125-runtime-artifact-storage-lifecycle/README.md)
- [ADR 0002：可重建运行产物必须有界](../../adr/0002-bounded-rebuildable-runtime-artifacts.md)
- [ADR 0009：Product Runtime Image 生成与消费](../../adr/0009-product-runtime-image-generation.md)
- [ADR 0010：桌面存储、loopback 与关闭生命周期](../../adr/0010-desktop-storage-loopback-shutdown.md)
- [Workspace 标准术语](../../../reference/workspace/TERMS.md)
- [NeuroBook Context](../../../CONTEXT.md)

外部参考：

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron ASAR Archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri Resources](https://v2.tauri.app/develop/resources/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Windows Installer / WebView2](https://v2.tauri.app/distribute/windows-installer/)
- [Microsoft WebView2 Distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [VS Code packaging pipeline](https://github.com/microsoft/vscode/blob/main/build/gulpfile.vscode.ts)
- [VS Code `.moduleignore`](https://github.com/microsoft/vscode/blob/main/build/.moduleignore)

## User Request / Topic

在正式开发桌面应用前，先完成以下前置工作：

1. 查清仓库中已有的相关 Task，不重做 Installation Root、State Root、Manager、Owned Process 和 runtime artifact 生命周期。
2. 解释并治理 Windows Portable 体积和文件数，重点收口 Product 中的大量 `node_modules`。
3. 为 Installed Desktop 与 Portable 建立文件存储、owner、更新、回滚、退出、卸载和缓存回收合同。
4. 解释 `Tauri Desktop Envelope + 独立 Bun Product` 的具体含义。
5. 评估 Tauri WebView 的 HTML/浏览器兼容风险，并用 Tauri/Electron 两个小型 spike 实测关键链路。
6. 明确 Tauri 是否能使用 ASAR，以及没有 Electron ASAR 虚拟文件系统时如何降低小文件数量。
7. 保留完整 Source 随发行携带、显式恢复 Git remote、安装开发依赖、本地构建和运行的能力。
8. 领域与服务源码尽量使用 Node/Bun 共同能力；Runtime 专属能力进入显式 Adapter，不把 Manager 和 Build Toolchain 误扩为双 Runtime。

## Goal

形成一个可实施的桌面版前置合同，使桌面壳不会接管 Product 领域逻辑，也不会破坏现有完整 Source、Manager、State Root 和 Portable 能力。

完成标准：

- Product Runtime Image 不依赖 Installation Root 根 `node_modules`，并把运行必需的动态 package/native island 与开发依赖明确分开。
- Product 文件数和体积有逐包归因、硬预算和 Release 门禁；优化后重新构建并用真实 Product smoke 验证。
- Desktop Envelope、Source、Product、Application Runtime、Toolchain、Developer Build State、State Root、Cache Root 均有唯一 owner 和生命周期。
- Installed Desktop 与 Portable 的路径、备份、迁移、更新、回滚、卸载和外部 Project Workspace 语义明确。
- Tauri 与 Electron 使用相同的功能矩阵验证 WebView、local HTTP、SSE、cookie、编辑器、剪贴板、拖放、下载、弹窗、退出和进程树收口。
- 最终框架选择由实测证据决定；当前推荐可以被 spike 推翻。
- Release Source 可以通过显式、可回滚的操作进入 Developer Source State，恢复 `.git`、安装根开发依赖并从 staging 构建新的 Product。

## Non-goals

- 本轮不直接实现 Tauri/Electron 生产壳。
- 不把整个仓库塞进 ASAR、Tauri executable 或 Bun 单文件 executable。
- 不为了“单 EXE”牺牲动态 Profile 编译、Skill package、native extension、完整 Source 或本地重建能力。
- 不承诺全仓、Manager、Package Manager 和 Build Toolchain 同时兼容 Node/Bun。
- 不建立一个统一管理所有 cache、artifact、Skill 依赖和开发依赖的通用 Artifact Store。
- 不默认把可修改 Source 安装到 `Program Files`。
- 不让 Tauri updater、Electron updater、安装器和 NeuroBook Manager 同时拥有同一路径。

## Current State

### 1. 已有 Task 与桌面版缺口

| Task | 已有地基 | 本 Task 不重复的部分 |
| --- | --- | --- |
| Task 26 | Windows Portable、浏览器启动、桌面窗口曾列为后续阶段 | 已被 Task 105 的目录和更新合同取代，仅作为历史依据 |
| Task 105 | Installation Root、State Root、Manager、Manifest、事务、更新和回滚 | 桌面壳、WebView profile、桌面卸载和 Desktop Envelope component 尚未建模 |
| Task 117 | Windows Owned Process、Job Object、Product/Agent 后代收口 | 桌面退出需要消费此能力，不另造进程扫描或 `taskkill /T` |
| Task 120 | Skill `node_modules` 的安装与保留合同 | 不能把 Skill 依赖和 Product/Developer 依赖一起清理 |
| Task 125 / ADR 0002 | 可重建 runtime artifact 的 owner、可达集合、预算和回收 | 桌面 cache、WebView profile、Bun cache 和 Product Runtime Image 需继续遵守同一原则 |

仓库目前没有独立覆盖“Desktop Envelope、WebView 数据、桌面退出、卸载语义和桌面缓存”的 Task。

### 2. 发行载荷基线

2026-07-27 本机 `.output` 快照：

| 路径 | 文件数 | 逻辑大小 | 说明 |
| --- | ---: | ---: | --- |
| 根 `node_modules` | 约 150,074 | 约 1.69 GiB | Developer Build State，不应直接进入 Release Product |
| `.output` | 约 44,578 | 约 819.67 MiB | 当前 Product build output |
| `.output/server/node_modules` | 41,950 | 586.29 MiB | 当前最大文件数与体积来源 |
| `.output/server/assets` | 339 | 104.04 MiB | 仍需排除不可达 `.compiled` / staging / cache |
| `.output/server/docs` | 1,301 | 87.36 MiB | 需要运行期白名单投影，不应复制 VitePress 构建缓存 |
| `.output/public` | 104 | 10.99 MiB | 前端静态文件不是当前主要文件数问题 |

旧 `dist/neuro-book-product-windows-x64.zip` 有约 44,998 个归档项，压缩后约 430 MiB、展开约 1.85 GiB；这是 Task 125 资产减重前的旧产物，只能用于定位结构，不能作为新方案的目标数字。

修复前构建脚本在 `externals.trace=false` 后自行收集 Nitro external package。它使用字符串正则寻找 `node_modules/<pkg>` 并复制每个 seed 的完整 `dependencies + optionalDependencies` 传递闭包。只读差分已确认前端资源清单中的六个字符串会被误判为服务端 import；旧快照中形成净新增闭包的主要是前四个：

- `dompurify`
- `katex`
- `mermaid`
- `monaco-editor`
- `nuxt`
- `vanilla-picker`

前四个假 seed 额外拖入约 168 个包、7,695 个文件和 192.50 MiB 原始体积。最终 ZIP 能减少多少必须重新构建测量，不能直接按 192.50 MiB 承诺；本轮隔离重建已确认六个候选都不再进入 discovered Seed。

已有 bundle spike 把 5,337 个实际可达输入收成约 37.25 MB 单文件，说明 bundle/tree-shaking 的收益很大；但该 spike 尚未通过完整 Product smoke，不能直接替换现有发布链。

严格离线 Portable 还包含约 158 MiB 压缩后的 PortableGit/工具链和约 38 MiB Bun。应区分：

- 大而完整的离线 Portable；
- 小型联网 Desktop Installer，首次需要时下载 PortableGit 或重型 Skill 依赖。

一个包同时追求“最小体积”和“完全离线开发环境”会显著增加复杂度，不作为默认目标。

### 3. 完整 Source 与开发态缺口

Task 105 已固定：完整 Source 展开在 Installation Root 根，Product 位于 `.output`，正式运行不得依赖根 `node_modules`。

当前仍有两个未闭环点：

- Manager 的 `materializeRepository()` 会拒绝已有完整 Release Source 的 Installation Root，Release Source 尚不能直接转为 Git checkout。
- Manager 没有正式 `rebuild` 命令，安装全量开发依赖、staging build、smoke 和切换 Product 仍只是目标合同。

## ADR / Decisions / Discussion

### D1：当前推荐是 Tauri Desktop Envelope + 独立 Bun Product

这里的“独立”指进程、Runtime、发布身份和生命周期独立，不是另建一个用户可见应用，也不要求拆成另一个仓库。

```text
NeuroBook.exe (Tauri / Rust Desktop Envelope)
    -> 定位 Installation / State / Cache Root
    -> 取得单实例与 Desktop lease
    -> 调用 NeuroBook Manager 恢复未完成 operation、迁移并启动 Product
    -> Manager 使用受控 Bun Runtime 启动 Product Runtime Image
    -> 等待 loopback health + 本地连接凭据就绪
    -> WebView 打开 http://127.0.0.1:<port>
    -> 窗口退出时先请求 Product flush/checkpoint/shutdown
    -> 超时后由 Owned Process lease 收口完整后代树
```

职责分配：

| Module | 负责 | 不负责 |
| --- | --- | --- |
| Desktop Envelope | 窗口、托盘、单实例、系统菜单、原生对话框、深链、WebView、桌面 lease | Agent、数据库、Profile 编译、业务路由、Product 依赖安装 |
| NeuroBook Manager | 安装、更新、operation 恢复、版本切换、migration、Runtime/Tool 和 Product 生命周期编排 | WebView 业务界面 |
| Bun Product | 现有 Nuxt/Nitro、API、Agent、Workspace、Profile/Skill runtime | 桌面窗口和安装器 UI |
| Product Runtime Image Builder | 把 Source 投影成可运行、可测量、有界的 `.output` | 管理用户 State Root 或根开发依赖 |

Tauri 的 Rust implementation 应保持小而稳定。Windows Job Object、reparse point 等 headless Product 也需要的能力不能只藏进 Tauri；应留在可被 Bun/Node/Manager 复用的 Adapter 或受控 native helper 中。

### D2：为什么当前先推荐 Tauri，而不是 Electron

| 维度 | Tauri + Bun Product | Electron + Bun Product |
| --- | --- | --- |
| 桌面 Runtime | Rust + 系统 WebView | Chromium + Electron Node |
| Product Runtime | Bun | Bun |
| JS Runtime 数量 | 一个 Product JS Runtime | Electron Node + Bun 两套 JS Runtime |
| 基础体积 | 较小，但依赖 WebView2 分发策略 | 较大，随包携带 Chromium/Node |
| 技术栈成本 | 增加 Rust/MSVC、WRY/Tauri 生命周期 | 基本全 TypeScript，桌面生态更成熟 |
| ASAR | 无 Electron ASAR 虚拟文件系统 | 可用于 Electron main/preload/renderer 和纯 JS 依赖 |
| 当前架构匹配度 | Envelope 可保持薄，Product 基本不变 | 容易诱导把 Product 逻辑搬进 Electron main，或形成重复 Runtime |

Electron 仍然是有效备选。若 Tauri 在 WebView、更新、签名、原生交互或 sidecar 生命周期上出现不可接受的真实问题，应允许 spike 推翻当前推荐。

### D3：Bun/Node 兼容政策

推荐正式表述：

> NeuroBook 领域与服务源码默认使用 Node/Bun 共同能力；Runtime 专属能力只能进入显式 Adapter。Bun 是 v1 默认 Application Runtime、唯一 Tool Runtime 和 Build Toolchain；Node 是 Product Runtime 兼容目标，不自动扩大为 Manager、Package Manager 和构建链兼容。

因此：

- `bun:ffi`、`bun:sqlite` 不绝对禁止，但不能从 Adapter 泄漏到领域调用方。
- 有两种真实实现时才建立 Runtime seam；不能为了假想 Node 支持制造大量 pass-through Interface。
- Windows reparse 检测等安全能力在不支持的 Runtime 下必须 fail closed，不能静默退化。
- v1 Desktop 继续携带受控 Bun Runtime，不要求 Electron/Tauri 替代 Bun Product。
- 第一版不把完整 Product `bun build --compile` 为单 EXE；动态 Profile、native extension、worker 和 package-shaped dependencies 需要先通过 Runtime Image smoke。

### D4：WebView 风险不是“旧浏览器”，而是分发、版本漂移和宿主差异

Windows Tauri 使用 WebView2。生产 WebView2 通常具有与当前 Edge Stable 接近的 Web 平台能力，因此 Monaco、TipTap、Vue、SSE、WebSocket、Clipboard 等标准能力本身不是首要阻断。

需要实测的风险：

1. WebView2 Runtime 是否存在、最低版本、离线安装和企业机器禁止更新。
2. Evergreen 自动升级带来的前向兼容；应在 Stable Runtime 和预览 Edge channel 做回归，而不是固定旧 Runtime 逃避测试。
3. Tauri 跨平台不是同一个引擎：Windows 是 WebView2，macOS 是 WKWebView，Linux 是 WebKitGTK。三平台行为差异高于单纯 Windows HTML 特性差异。
4. `window.open`、外部链接、下载、文件选择、拖放、剪贴板、通知、权限提示和 DevTools 需要桌面宿主策略。
5. WebView user data folder 中的 cookie、localStorage、IndexedDB、HTTP cache 和 Service Worker 的位置、迁移、清理和备份语义。
6. Product 启动竞态、空白页、loopback 端口、SSE 断线恢复、cookie/SameSite、Origin/CSP 和本地连接凭据。
7. Tauri 默认只允许 bundled code 使用本地命令；`http://127.0.0.1:<port>` 属于 remote source。动态端口与精确 remote capability 是否能同时收紧必须实测，不能为了调用原生能力给任意网页开放宽权限。
8. Evergreen 更新后长时间运行的应用仍使用旧 Runtime，必要时要提示保存状态并重启。

当前 Nuxt 配置 `ssr: false`，理论上可把 SPA 静态文件作为 Tauri `frontendDist` 嵌入 executable。但 `.output/public` 目前只有 104 个文件、10.99 MiB，不是主要问题。v1 推荐 WebView 继续打开 Bun Product 的 loopback HTTP 地址，以保留同源 API/cookie/SSE 合同；把前端嵌入 Tauri 会引入 API base、CORS、cookie 和 CSP 改造，收益暂时不足。

Windows WebView2 Installer 当前可选：

| 模式 | 额外 Installer 大小 | 网络 | 建议 |
| --- | ---: | --- | --- |
| `downloadBootstrapper` | 0 MB | 需要 | 小型联网 Installer 默认候选 |
| `embedBootstrapper` | 约 1.8 MB | 需要 | 想减少 bootstrapper 下载失败时可选 |
| `offlineInstaller` | 约 127 MB | 不需要 | 严格离线 Desktop/Portable 才考虑 |
| `fixedRuntime` | 约 180 MB | 不需要 | 默认不选；体积大且安全更新责任转给 NeuroBook |
| `skip` | 0 MB | 不安装 | 不建议；Runtime 缺失时应用不能启动 |

因此“小型联网 Desktop”和“严格离线 Portable”应允许不同 WebView2 策略。

### D5：ASAR 只属于 Electron；Tauri 有两类不同机制

ASAR 的主要目的确实是降低物理文件数、长路径和文件系统访问开销。它默认不压缩，不是 tree-shaker、编译器或保密机制。Electron 给 `fs`、`require` 和 Chromium 增加了 ASAR 虚拟文件系统；native addon、spawn、真实路径、mmap 等仍需 unpack。

Tauri 没有这套 Electron ASAR 虚拟文件系统：

- Tauri codegen 会把 `frontendDist` 的前端资产嵌入、hash 并压缩进 Rust executable。这适合 Desktop Envelope 自身的静态 UI。
- Tauri `bundle.resources` 会把额外文件复制到平台 Resource Directory，运行时仍是普通文件树。安装介质可以压缩，但安装后文件数没有消失。
- Tauri `externalBin` 只负责随包携带可执行 sidecar，不会把 Bun Product 的动态文件系统透明挂载成 archive。

所以 NeuroBook 的顺序应是：

1. bundle/tree-shaking 真正减少 Product 代码和依赖。
2. 保留必须有真实路径或 package 形状的 native/dynamic islands。
3. 对完整 Source、Developer Build State 和用户 State 保持普通文件系统。
4. 只有最终选择 Electron 时，才对 Electron Envelope 自身评估 ASAR。

不建议现在为 Bun Product 自造 ASAR 类虚拟文件系统。它会要求所有动态读取方通过新的 archive-aware Interface，复杂度很高；当前 bundle spike 已证明先做 Runtime Image Builder 的收益更直接。

### D6：参考 VS Code 的分层，而不是复制它的文件格式

VS Code 的可借鉴点是：

1. 自身源码按 main、workbench、extension host、worker 等入口 bundle/minify。
2. 只收集 production dependencies，并用 `.moduleignore` 精确裁掉 tests、docs、source、build files 和无关平台二进制。
3. `.node`、WASM、executable、worker 和需要真实路径的包进入 unpacked/普通目录。

NeuroBook 对应目标：

```text
.output/                              # Product Runtime Image
├─ runtime-image.json
├─ server/
│  ├─ index.mjs
│  ├─ core/                           # 稳定 Product bundles
│  ├─ commands/                       # create-admin / migration / CLI 等预编译入口
│  ├─ authoring/                      # 与 Product revision 绑定的 Profile Authoring Kit
│  └─ node_modules/                   # native / 动态解析 package islands
├─ public/
└─ system-assets/
```

Profile 编译需要的源码、SDK 和 compiler dependency 应组成与 Product revision 绑定的 Authoring Kit。正式 Product 不能回退读取用户可能已修改的根 Source 或根 `node_modules`。

### D7：初步目录结构

```text
NeuroBook/                            # Installation Root
├─ NeuroBook.exe                     # Desktop Envelope 稳定入口
├─ .desktop/
│  ├─ current.json
│  └─ versions/<version>/...
│
├─ app/ server/ shared/ scripts/ assets/
├─ package.json
├─ bun.lock                          # 展开的完整 Release Source
├─ .git/                             # 可选 Developer Source State
├─ node_modules/                     # 可选 Developer Build State
├─ .nuxt/                            # 可选 Developer Build State
│
├─ .output/                          # 当前 Product Runtime Image
├─ .runtime/
│  ├─ bun/<version>/
│  ├─ manager/<version>/
│  ├─ tools/<name>/<version>/
│  ├─ helpers/<version>/
│  └─ bin/
├─ .deploy/
│  ├─ installation.json
│  ├─ operations/
│  ├─ staging/<operation-id>/
│  ├─ backups/
│  └─ developer-build.json
├─ data/                             # Portable State Root
└─ .cache/                           # Portable Cache Root
```

Installed Windows 推荐：

```text
Installation Root = %LOCALAPPDATA%\Programs\NeuroBook
State Root        = %LOCALAPPDATA%\NeuroBook\data
Cache Root        = %LOCALAPPDATA%\NeuroBook\cache
Desktop Local Root= %LOCALAPPDATA%\NeuroBook\desktop
WebView Root      = %LOCALAPPDATA%\NeuroBook\desktop\webview
```

Portable 推荐：

```text
Envelope Root == Installation Root
State Root     = <Installation Root>/data
Cache Root     = <Installation Root>/.cache
Desktop Local Root = <Installation Root>/data/.desktop
WebView Root       = <Installation Root>/data/.desktop/webview
```

WebView Root 是混合的 device-local UI state，不应整体冒充普通 cache：其中 HTTP/GPU/Code cache 可删除，但 cookie、localStorage 和 IndexedDB 会影响登录与未发送草稿。它随正常更新保留、默认不进入内容备份；只有在关键草稿迁出后，“重置桌面数据”或卸载才可明确删除整个 profile。

Installed v1 不放 `Program Files`，因为完整 Source、`.git`、根 `node_modules` 和本地 build 都要求普通用户可写。未来如需系统级只读安装，应先把 Developer Source State 拆到另一个用户可写 root，不应靠提权写 Source。

### D8：owner 与生命周期

| 数据/路径 | Owner | 更新/清理合同 |
| --- | --- | --- |
| `.desktop/versions` / `NeuroBook.exe` | Desktop Envelope Module；Manager 统一编排更新 | 版本目录不可变；退出后切换；不能同时启用 Tauri updater |
| 展开 Source | Source Module | Release 只拥有 manifest 精确文件；Git 模式由 Git 拥有；禁止递归覆盖 Installation Root |
| 根 `node_modules` / `.nuxt` | Developer Build Module | 按需生成，按 lock hash + Source identity 失效；不发布、不备份、不由普通更新删除 |
| `.output` | Builder 生成 verified candidate；Manager 激活受管 Product | staging 构建/下载、完整验证、migration 与 smoke 后切换；活跃 lease 和 rollback 引用存在时不删除 |
| `.runtime/bun` | Application Runtime Module | 新版本先安装后切换；无 lease、无 rollback 引用后回收旧版本 |
| `.runtime/tools` | Tool Module | Git/rg/bash 等分别版本化和失效；不是根开发依赖 |
| State Root | 用户与各领域 Module | Release 永不覆盖；migration 必须有版本和失败恢复 |
| Desktop Local Root / WebView profile | Desktop Envelope Module | 正常更新保留、内容备份排除；profile 内 cache 可回收，整 profile 删除属于显式桌面重置/卸载动作 |
| Cache Root | 各 cache Module | 不是真相源；必须可重建、有硬预算和回收时机 |
| `.deploy/operations` / backups | Manager | 属于事务和回滚证据，不是可任意删除的 cache |
| 外部 Project Workspace | 用户 | 更新、回滚、卸载、“清空应用数据”默认均不得删除 |

必须区分三种 `node_modules`：

- 根 `node_modules`：Developer Build State。
- `.output/server/vendor/node_modules`：Product 的窄 package/native islands。
- `State Root/workspace/.nbook/agent/skills/**/node_modules`：Skill 自己的可重建依赖，保留 package 解析形状并由 Skill 合同失效。

### D9：llmlint、Bun、WebView 和临时文件

- NeuroBook 内嵌 llmlint 使用 `LLMLINT_HOME=State Root/tool-state/llmlint` 与 `LLMLINT_CACHE_DIR=Cache Root/llmlint`，不读取或迁移用户独立运行 llmlint 的 `~/.llmlint`。detect cache 固定为 1000 项、128 MiB、30 天。
- 不得全局覆盖 `HOME` 或 `USERPROFILE`，否则会改变 Skill 和用户文件的含义。
- 托管 Bun 命令使用 NeuroBook 专属 `BUN_INSTALL_CACHE_DIR=Cache Root/bun/install`，不复用宿主默认 cache。当前没有受管 `bun install` 消费者；硬预算在未来 Developer Build install 完成点执行，不在普通启动时递归扫描。
- Composer 草稿已迁入 Workspace Root `.nbook/agent/composer-drafts.json`；单条 256 KiB、最多 10 条、保留 30 天，首次加载迁移旧 WebView 草稿，发送成功删除。WebView profile 因此可以由显式桌面重置整体删除。
- `State Root/logs` 固定按 8 个文件、80 MiB、30 天回收，并从用户内容备份语义中排除。
- Bash 完整输出位于 `Cache Root/agent/bash-output/<lease>`，只持久化逻辑 locator；7 天、128 个文件、256 MiB，总是受 owner marker 与硬预算约束。

### D10：安装、更新、退出和卸载

安装/更新：

1. 下载到 staging 并校验签名、hash、platform 和 revision。
2. 分别安装不可变 Envelope、Product、Runtime 和 Tool 版本。
3. 运行 migration/preflight/Product smoke。
4. 只在验证通过后切换 current identity；失败恢复旧代。
5. State Root 永不被 Release 文件覆盖。

退出：

1. Desktop Envelope 停止接收新的窗口动作，Manager 向 `127.0.0.1` Product 发送带单次 256-bit token 的关闭请求。
2. Product 进入 drain，等待在途 HTTP lease，依次关闭 Agent、Project、Workspace File Index、Session Store，执行 App SQLite checkpoint、Prisma disconnect 和日志 flush。
3. Product 在控制请求返回 202 后退出；Nitro signal close 与控制请求共享同一个幂等 shutdown 结果。
4. 30 秒超时、Product crash 或控制通道失败后，通过 Owned Process lease 强制收口 Bun、Bash 和完整 Agent 后代树，并报告 forced shutdown。
5. 进程和继承资源真正收口后，Desktop lease 才完成；Windows 不依赖 JavaScript `SIGTERM` handler。

卸载：

- 默认删除程序版本、可重建 cache、WebView profile 和有界日志，保留 State Root 用户内容。
- 只有用户明确选择“同时删除数据”才删除托管 State Root。
- 外部 Project Workspace 永远需要单独、明确的用户删除操作。

### D11：桌面本地连接安全是前置 Gate

Desktop Product 已由 Manager 强制监听 `127.0.0.1`，不能把“免登录”与“只对本机开放”混为一件事。Manager/Product shutdown 控制面使用每次启动随机凭据；普通页面的 Origin/CSP 与 Tauri capability 仍必须在 Desktop Envelope spike 中单独验证。

若 WebView 直接加载 loopback HTTP，Tauri remote capability 不应默认给整个页面开放任意系统命令。原生能力按窗口 label 和最小权限配置；普通 Product 页面只能获得明确需要的少量 Desktop Interface。

## Verification / Test

### Product Runtime Image

- 记录总字节、总文件数、最大依赖、Top package 和各层 owner。
- 对前端构建包进入 server vendor 设置 denylist/allowlist 门禁。
- 删除或重命名根 `node_modules` 后，Product start、管理员命令、migration、Profile compile、Skill/Agent CLI smoke 仍通过。
- native extension、dynamic import、worker、`package.json` 读取和 executable spawn 分别有真实路径测试。
- bundle 分层后修改一个普通 server 模块，不要求替换所有大型 native/runtime island。

### Tauri / Electron 同矩阵 spike

- 启动 Bun Product，动态端口 health ready 后再显示主界面；失败显示可诊断错误页，不留空白窗口。
- Nuxt 路由刷新、API、SSE、WebSocket、cookie 登录与退出通过。
- Monaco、TipTap/Milkdown、Mermaid、Vue Flow、主题、中文输入法、缩放通过。
- 图片拖放、文件选择、剪贴板、下载、`window.open`、外部链接和新窗口策略通过。
- localStorage/IndexedDB/cookie 的 profile 路径、重启持久化、清理和升级行为可预测。
- 关闭窗口、托盘退出、Product crash、Envelope crash、启动超时和卡住 Agent Bash 后，进程树与端口有界收口。
- Windows Evergreen WebView2 当前版与 Preview channel 做前向兼容；离线缺失 Runtime 路径有明确安装/错误行为。
- 至少做 Windows 100%/125%/150% DPI 和多显示器；框架确定后再扩 macOS/Linux WebView 矩阵。

### Lifecycle

- 更新成功、更新失败回滚、运行中版本保护、断电/强杀后 operation 恢复。
- Portable 整目录移动后所有相对 locator 仍成立。
- Installed 卸载默认保留 State Root；“删除应用数据”不触碰外部 Project Workspace。
- WebView/cache/log/Bun cache/Skill dependency 各自达到预算后收敛，不按目录名统一删除。

## Implementation Plan

### Phase 0：基线与合同

- 固定当前 Product/Source/Tool/WebView 体积与文件数基线。
- 生成逐包/逐 owner 的 Runtime Image 报告。
- 冻结 Tauri/Electron 共用 spike 验收矩阵和 Windows-first 范围。

### Phase 1：Product Runtime Image Builder

- 用真实 module specifier 解析替换 `node_modules/...` 字符串正则 seed。
- 修复四个已确认假 seed，重新构建并测量最终 ZIP。
- 建立 server bundle 分层、commands 和 Authoring Kit。
- 只保留 native/dynamic package islands。
- 对 system assets 和 docs 使用运行期白名单投影。
- 加入文件数、字节数、最大 package 和禁止依赖门禁。

### Phase 2：Desktop Storage / Lifecycle ADR

- 冻结 Installed/Portable 的 Installation、State、Cache、WebView root locator。
- 为 Manifest 增加 Desktop Envelope、Application Runtime kind、Runtime Image identity、Cache/State locator 和 Developer Build identity。
- 明确 llmlint、Bun cache、Skill dependency、日志、WebView profile、临时文件、备份和卸载合同。
- 设计 Release Source -> Git Source -> Developer Build -> Product switch 的可回滚操作。

### Phase 3：loopback 安全收口

- Desktop 启动强制 `127.0.0.1`。
- 建立本地连接凭据、Origin/CSP 和最小 Tauri capability。
- 验证无鉴权 Desktop 不会暴露到局域网。

### Phase 4：Tauri / Electron 双 spike

- 两个 spike 都只做薄 Envelope，调用同一个 Manager/Bun Product。
- 使用完全相同的测试矩阵、计时、安装包体积、运行内存和失败诊断口径。
- 记录 WebView2 分发、sidecar 生命周期、签名、更新和 Portable relocation 结果。
- 基于结果冻结 Desktop Envelope 技术，并决定是否需要 ADR。

### Phase 5：首个 Desktop Release

- 实现选定 Envelope、单实例、托盘、启动错误页和退出收口。
- 接入 Manager 更新编排；不启用第二套 updater ownership。
- 产出小型联网 Installer；严格离线 Desktop/Portable 另设 Release 资产和预算。
- 完成真实用户安装、升级、回滚、卸载和数据保留验收。

## Open Decisions

1. 第一版是否只发布 Windows Desktop。当前建议 Windows-first spike，架构保留三平台；在 Windows 合同未稳定前不同时承担 WKWebView/WebKitGTK 差异。
2. 严格离线 Portable 是否必须内置 WebView2 offline installer。若必须，接受约 127 MiB 额外 Installer 体积；否则明确 WebView2 prerequisite。
3. v1 WebView 是否继续加载 loopback HTTP。当前建议是；将 SPA 嵌入 Tauri executable 延后到真实文件数/启动性能证明值得。
4. 最终 Tauri/Electron 选择。当前建议 Tauri，但必须由 Phase 4 证据冻结。
5. Node Product Runtime 兼容目标的优先级。当前不应阻塞 Bun Desktop；先收紧 Adapter 与 fail-closed 门禁。

## Implementation Walkthrough

### 2026-07-27：前置调研与 Task 建档

- 复核 Task 26/105/117/120/125 和 ADR 0002，确认桌面壳与桌面生命周期仍是缺口。
- 测量当前 `.output`：真正的 4 万级文件问题在 `.output/server/node_modules`，不是 Installation Root 根开发依赖，也不是 104 个前端静态文件。
- 复核 VS Code 打包链：bundle 自身入口、精裁 production dependencies、ASAR/unpacked 分层；确认 ASAR 主要解决文件数而非体积。
- 调研 Bun/Electron/Tauri：Electron main 仍是 Node；Tauri 可用 Bun 做包管理器并携带 sidecar，但 Bun Product 仍是独立进程。
- 调研 Tauri Resources 与 WebView2 分发：Tauri 可嵌入前端资产，但普通 resources 仍会展开；Windows Evergreen/offline/fixed Runtime 有不同体积和安全取舍。
- 收敛出 Product Runtime Image Builder、Application Runtime Capabilities、Desktop Envelope 三个待深化 Module；优先处理 Product Runtime Image Builder。

### 实际结果与初始假设差异

- 初始认为“根 `node_modules` 太大导致 Portable 太大”；实测确认 Release 的直接问题是 Product 构建脚本复制出的 `.output/server/node_modules`。
- 初始把 ASAR 当成通用小文件方案；调研确认它依赖 Electron 的虚拟文件系统，对独立 Bun Product 无效。
- Tauri 能把 SPA 前端嵌入 executable，但当前前端仅 104 个文件；为了这点收益改造同源 API/cookie/SSE 不划算。
- 桌面版不只是增加一个窗口。WebView profile、loopback 安全、更新 owner、退出 flush、卸载保留数据和 Developer Source State 都必须先形成合同。

### 2026-07-28：Nitro Runtime 假 Seed 修复（Phase 0 / Phase 1 首片）

- 新增 `scripts/build/nitro-runtime-module-specifier.mjs`，以 `es-module-lexer` 只分析静态 import、side-effect import、export-from 和字符串字面量 dynamic import；普通对象字段、注释、source map 与前端资源映射不再形成 Seed。
- Nitro external 的 `file:///.../node_modules/pkg`、Bun `.bun/.../node_modules/pkg` 和 pnpm `.pnpm/.../node_modules/pkg` 统一改写到扁平 `.output/server/node_modules/pkg`；支持 scoped package、深层 chunk、query/hash 与 Windows/POSIX URL，并在复制前校验物理包和根 hoisted package 的 `name/version`。版本不一致直接失败。
- `patch-nitro-runtime-deps.mjs` 现在先清理旧 vendor，只扫描 Nitro 可执行图与 Product system artifact，合并声明 Seed 和语法发现 Seed，再复制 `dependencies + optionalDependencies` 闭包；保留动态 import、native addon、worker 和 `createRequire` 所需的声明 Seed。
- 该轮隔离构建只证明假 Seed 修复：297 个闭包包、26,693 个 vendor 文件、323,185,608 bytes（308.21 MiB），3,384/3,384 个路径型 external 可解析，六个前端资源字符串均未进入 discovered Seed。它不是后续 Runtime Image Builder 的最终 clean-build 证据。
- 同轮旧 Windows Product overlay 为 30,272 个文件、320,621,965 bytes；它仍使用完整依赖闭包，不能作为 Phase 1 完成结果。旧损坏 vendor 的 189.30 MiB 同样不能作为上限，因为它缺少 17 个真实目标。
- `product-runtime.mjs` 的 system asset 编译现在使用临时 `.product-build-state`，并在 `finally` 删除，避免 staging 自己在 Product Root 生成 `workspace/.nbook/logs` 影子状态。
- 运行验收：Product Application State catalog v2 `--apply` 与重复 Prisma deploy 通过；14 个 Profile 中 `writer` 的 check/compile 通过；Product vendor 直接加载 sqlite-vec 并完成向量召回；稳定 `workspace` CLI 完成 Project 创建、Project SQLite、内容节点创建和校验；Product 使用 Owned Process health 后以 `terminationReason=shutdown` 收口。
- 额外的 `product-agent-state-root-smoke.ts` 已完成 Agent 文件工具与 Session 写入，但旧 smoke 只关闭单个 Project，没有执行进程级 `closeAllProjects()`，因此移动 State Root 返回 `EPERM`。日志使用逐次 append，并没有长期句柄；旧“日志句柄导致 EPERM”的归因撤回。

### 2026-07-29：Product Runtime Image Builder（Phase 1 收口）

- `ProductRuntimeImageBuilder` 现在只暴露 candidate build 与 verified open：构建前后锁定 Source、lockfile 和平台身份，候选在 `.deploy/staging` 持 lease，manifest/ready marker 最后提交；当前 `.output` 只由本地 Publisher 在二次验证后原子切换。
- Product 从完整依赖闭包改为 Nitro 单 bundle、共享 command bundles、Profile Authoring Kit、System Assets projection 与显式 package islands。最终同源五代 dirty 本地验证构建均为 4,683 个文件、161,274,231 bytes（153.80 MiB），`sourceDigest`、`treeDigest`、`shapeDigest`、`imageId` 和七个 owner inventory 完全一致，只有 `createdAt` 与 ready marker hash 不参与 payload 身份；dirty 证据不替代正式 clean Release。
- Profile/Variable 在空白 Product 投影中重新编译；Product orphan 与 staging 均为零。14 个内置 Profile 与两个模板通过 `nbook/profile-sdk` 公开入口编译。Authoring Kit 仍包含 Pi/Provider、Prisma 与 Zod 声明，因为它们是 SDK 公开类型的传递依赖；`typebox` 额外携带运行 implementation。
- Release、Portable、Docker 与 Manager 统一消费 verified image identity。Portable 从传入的 Source/Product archive 组装，不再读取 live checkout；`dist` 按 version/build ID 隔离，`product:stage` 迁到 `.agent/workspace` 的带 lease 临时验收实例。
- 仓库外命令 smoke 最初在 HTTP 启动时暴露 `typescript` 解析基准错误；根因是 raw chunk 的相对 `../../index.mjs` 在 bundle 合并后越过 Product，现已在最终 bundle 统一改为 `import.meta.url`，并增加真实 bundle + `createRequire("typescript")` + `--no-install` 回归。
- 最终镜像已复制到 `C:\` 下祖先无 `node_modules` 的独立 Application Root，清空 `NODE_PATH` 后通过 SQLite/Application State migration、Profile compile/typebox、workspace schema 与实际 node 写入、sqlite-vec、Sharp、create-admin、version、错误 token 401、正确 token 202 shutdown、端口关闭及 State Root 移动/删除。`scripts/release/verify-windows-product.ts` 固化该矩阵并由 Windows Portable workflow 调用；workspace node 现在从真实 Project Workspace 使用相对 `manuscript/...` 地址，不能再用绝对路径掩盖 cwd 回归。
- 路径与 shape 门禁确认所有可执行 `.mjs` / runtime JSON 中没有构建仓绝对路径、`.bun`、`.pnpm`、`../../index.mjs` 或 `file:///_entry.js`，也没有 raw `server/chunks`、`server/scripts`、runtime 源码投影或 docs 副本。
- 构建环境改为显式投影并使用 tracked `.env.product`；Product 模式强制 production/node-server、关闭 devtools、固定 UTC/C locale 与 `SOURCE_DATE_EPOCH`。Nitro public asset 使用 code-unit 排序，Source digest 不再混入 branch/upstream/index 表示，因此同一内容不受分支名、detached HEAD、暂存方式或宿主 locale 影响。
- prepare/raw build/postprocess/publish 全链由全局 fail-fast lease 串行化；Release 归档与 `.output` 切换共用 Publisher lease。成功 operation 不留 staging marker，下一次构建会回收无 candidate、无活跃锁的历史 marker；Release manifest/checksum 在读取输入归档前 fail-fast，`runCapture()` 等到 stdio close。
- 验收与计划的实际偏差：构建曾因并行 Source 修改被竞态门禁拒绝，候选没有发布；真实 Bun metafile 又暴露相对 output key，修复后明确以 commands outdir 解析并保留 `../` 逃逸门禁。一次测量把 `NEURO_BOOK_OUTPUT_DIR` 指向非 `.output` 叶子，Builder 完成而 Publisher 按合同拒绝，ready candidate 经二次验证后才原子发布到正确目标。Windows Bun 1.3.14 对已清空 scratch root 的 `fs.rm()` 返回 `EFAULT`，验收脚本改用语义明确的 `rmdir()`。当前工作树包含大量其他任务的 dirty 变更，因此本地不伪造正式 clean Release archive；Windows workflow 会在 clean runner 上执行同一验收 Module。
- 四项有意偏差已写入 ADR 0009：scratch 位于候选内并在 inventory 前删除；local checkout Publisher 不复制 Manager 的安装级 rollback；jsdom/undici/TypeScript 等仍按已登记 dynamic/native island 保留真实 package 形状；Linux/macOS 在实测 owner baseline 登记前 fail closed，而不是借用 Windows 预算。

### 2026-07-29：Storage、locator 与 shutdown（Phase 2/3 共享地基）

- Installation Manifest schema v5 使用 `installation-root` / `local-app-data` typed locator，统一解析 State、Cache、Desktop Local 与 WebView Root；Portable 整体移动不持久化绝对路径。
- Product `RuntimePaths` 增加 Cache Root；Manager 与 Docker 统一注入 llmlint state/cache、Bun install cache，并强制 Desktop Product 监听 `127.0.0.1`。
- 图片变体、llmlint、日志、Bash 完整输出和 Composer 草稿均有独立 owner、预算、失效与删除语义。Bun cache 已隔离；硬预算等待未来受管 install 完成点，不把普通启动改成全盘 cache 扫描。
- Manager 已实现默认保留 State Root 的卸载和显式 desktop reset；外部 Project Workspace 不进入删除集合。
- Product shutdown controller 统一 HTTP drain、Agent、Project、Workspace File Index、Session Store、SQLite checkpoint、Prisma 与日志 flush。Manager 使用认证 loopback 请求优雅关闭，30 秒后才让 Owned Process 强制收口。
- `openControlPlane()` 将 Manager status/discovery 的 verified 控制面检查从完整 payload 冷启动约 13.3 秒降到约 4-9 毫秒；执行、安装、激活和归档仍使用 `openVerified()`。

### 2026-07-29：最终回归、体积与生命周期收口

- `shared/product-runtime-environment.ts` 成为 Manager 与独立 Product 启动器的唯一环境优先级实现：State Root `.env` 仍可配置普通应用项，但 Application/State/Cache Root、日志、llmlint、Bun cache 和受管 host 在最后固定。卸载与 desktop reset 在 install lock 内先执行 stop gate 再删除；日志归档 manifest 不再记录绝对 `logDirectory` 或 `cwd`。
- `native-islands.json` 升级为 v2，opaque dynamic import 必须按 Product 相对路径模式登记精确数量、原因与 smoke。最终闭包覆盖 `server/assets/**/*.mjs`；commands 从 Bun metafile `entryPoint` 建立入口映射。最终构建日志为 `rawModules=197`、`rewrites=3558`、声明 islands 52 个、发现 Seeds 34 个。
- 清理前的 `C:\nbook-task130-final-r-20260729\.output` 与 `C:\nbook-task130-final-s-20260729\.output` 均为 4,683 个 inventory 文件、161,274,231 bytes，`imageId=sha256:2ed10249a86bd95ab48cf0aa912f10b791126a966bf44bcceb7312ed807e4b0b`。排除 `runtime-image.json` 与 `runtime-image.ready` 后，4,683 个 payload 文件的路径差异和逐文件 SHA-256 差异均为 0；证据已记录后删除临时副本。
- Windows owner baseline：frontend 176 / 15,810,725 bytes；server-bundle 1 / 12,571,222；commands 102 / 10,692,845；authoring-kit 1,923 / 20,694,368；native-islands 2,102 / 86,688,809；system-assets 376 / 14,812,033；runtime-meta 3 / 4,229。
- 清理前的 `final-r` 在仓库外再次通过 database/Application State migration、Profile/typebox、workspace CLI、sqlite-vec、Sharp、create-admin、HTTP version、错误/正确 token shutdown、端口关闭和 State Root 移动/删除。按正式 ZIP 实现生成的本地 dirty 验收包包含 4,685 个物理条目（payload 加两个镜像控制文件），压缩后 47,698,142 bytes；旧 47,564,878 bytes 只保留为历史镜像数据，不作为本轮门禁。
- 回归结果：Task 130 聚焦 Vitest 27 files / 114 tests；Manager 33 files / 211 tests（另 1 file / 2 tests 按平台跳过）；Manager `pack:check` 通过，包内 5 个文件、unpacked 2.23 MiB、packed 0.41 MiB。根 `bun run typecheck` 仍只有其他任务的 llmlint fixture `ignoreTerms` 与 `module`/`builtin` 基线错误，本轮不修改。
- Manager 专用收尾检查 `bun run manager:test` 通过（33 files，211 passed，2 skipped），`bun run manager:typecheck` 通过；根 `.output` 清理后再次通过 `openVerified()`，仍为 4,683 个 payload 文件、161,274,231 bytes，且 `staging`、`staging-leases`、全局 builder/publisher lease 均为空/未持有。根 `product/`、本轮验证副本和旧 candidate 已删除，旧 `dist/` 归档未删除。
- 2026-07-31 发布准备补齐独立 Runtime 编译边界：跨边界代码显式导入 `h3.createError`，Runtime tsconfig 显式消费既有 Web extraction 声明与 Bun host 类型，根 package 直接持有 `@types/bun`，不再依赖兄弟 workspace 的偶然 hoist。`bun run runtime:typecheck`、Manager typecheck/test/pack、install tests 与 Release contract 28 项均通过；根 typecheck 仍只剩上条已登记的 llmlint fixture 漂移。
- 同日 clean-checkout Manager 发布连续暴露隐式前置：Prisma client 来自 ignored 生成目录，`mdast` 类型来自传递依赖偶然 hoist，Manager 新增的 `scripts/**` / `shared/**` Product Builder 导入又会让 Vite/OXC 回退到根 Nuxt tsconfig。`runtime:typecheck` 现自行生成两套 Prisma client，Prisma 输出、scripts、shared 与 server/runtime 各有不继承 Nuxt 的边界 tsconfig，根 package 直接持有 `@types/mdast`；发布合同测试已并入 `manager:test`。失败的 Manager `.31` / `.32` 只保留审计，后续使用 `.33`。
- 仍未完成：Linux/macOS owner baseline 未在真实平台构建，继续 fail closed；当前 dirty 构建不能替代 clean Release runner；浏览器验收和 Tauri/Electron spike 未执行。

## TODO / Follow-ups

- [x] Phase 0：生成可重复的 Product Runtime Image 体积/文件数基线与归因报告。
- [x] Phase 1：修复 Nitro external 假 seed 并重建测量。
- [x] Phase 1：完成 Runtime Image bundle/Authoring Kit/native islands 设计与 Product smoke。
- [x] Phase 2：形成 Desktop Storage / Lifecycle ADR，并扩展 Manifest locator/component 模型。
- [ ] Phase 2：设计并实现显式 Developer Mode / rebuild 事务。
- [x] Phase 3：收口 Product loopback host、shutdown 凭据与关闭生命周期。
- [ ] Phase 3：在 Desktop Envelope spike 中验证普通页面 Origin/CSP 和最小 Tauri capability。
- [ ] Phase 4：执行 Tauri/Electron Windows 双 spike。
- [ ] 基于 spike 结果冻结 Desktop Envelope 技术选择。
- [ ] Phase 5：实现首个 Desktop Release、更新、回滚、退出和卸载闭环。
