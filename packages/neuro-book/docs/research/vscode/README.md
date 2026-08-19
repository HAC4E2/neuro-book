# VS Code 架构深挖：从打开窗口到首次插件调用

> 调研状态：research；不是 NeuroBook 当前产品合同。  
> 调研问题：打开 VS Code 后，哪些进程、宿主、服务、状态模型和插件边界共同把用户动作变成可见结果？这些机制对 NeuroBook 的渐进式插件系统与可重排工作台有什么启发？  
> 证据标签：**已验证** = 固定 commit 源码或官方文档直接确认；**从源码推断** = 多个已验证事实的关系归纳；**未验证** = 本轮没有构建、启动或真实远程环境观察。

## 结论先行

VS Code 不是“一个 Electron 页面加若干插件回调”。它是一个控制平面：桌面主进程先建立环境、文件、配置、状态和 IPC；renderer 进程装配 Workbench；Workbench 再通过服务注册表、Part/View/Editor 模型恢复界面；扩展描述先进入注册表，只有在命令、View、语言或其他事件真正需要时，才在合适的 Extension Host 中激活运行时代码。

对 NeuroBook 的直接启发不是复制 VS Code 的 `activate()` 入口，而是分离五件事：

1. **描述**：资产声明“提供什么”，先登记，不执行。
2. **宿主控制**：命令、配置、View、文件/附件、后台任务等入口由宿主拥有。
3. **惰性运行**：首次能力调用才启动对应运行时，并记录成功、失败和禁用状态。
4. **状态持久化**：布局、配置、会话快照、资产来源账本各自有明确作用域。
5. **边界与故障**：Extension Host 是故障隔离和能力代理边界，但不是恶意代码安全沙箱；NeuroBook 的第三方可执行资产必须另做威胁模型。

这份报告是研究映射，不把这些启发写成 NeuroBook 已批准的 API。采用某条行为时，仍需另建 Proposal/Spec/ADR。

## 一页人话模型

- **Main process（主进程）**：桌面 Electron 的总管，处理单实例、窗口、主进程 IPC、用户数据目录和系统能力。
- **Workbench（工作台）**：用户看到的控制平面；管理布局、编辑器、命令、配置、View 和生命周期。
- **Part（工作台区域）**：标题栏、Activity Bar、侧栏、Panel、编辑器区、状态栏等宿主区域。
- **View Container（View 容器）**：装一组 View 的可移动抽屉，例如侧栏中的 Explorer 容器。
- **View**：容器内的一项可显示能力；它可以延迟创建内容，但位置和可见性由宿主记录。
- **EditorInput / EditorPane / EditorGroup**：分别是“打开了什么”、 “用什么 UI 显示”、 “在哪个编辑器分组显示”。
- **Extension Host（扩展宿主）**：承载扩展运行时代码的独立进程或 Web Worker；Workbench 通过 RPC 代理调用它。
- **Remote Agent / Remote Extension Host**：当工作区在另一台机器时，远端 Node 服务提供文件、终端和远程扩展执行，浏览器或桌面端仍主要负责 UI。
- **Service identifier / InstantiationService**：依赖注入的钥匙和解析器；服务先以 descriptor 登记，首次取用时才按依赖图创建实例。

### 总拓扑：桌面、本地 Web、微软 VS Code Server

```mermaid
flowchart LR
  subgraph Desktop[桌面本地工作区]
    Main[Electron Main process\n窗口/单实例/主 IPC]
    Renderer[Electron renderer\nWorkbench]
    LocalEH[Local Process Extension Host\nNode 扩展运行时]
    Shared[Shared process\n跨窗口共享服务]
    Disk[(本机文件/用户数据)]
    Main <--> Renderer
    Renderer <--> LocalEH
    Renderer <--> Shared
    Main <--> Disk
    Renderer --> Disk
  end

  subgraph Web[浏览器 Web Workbench]
    Browser[Browser Workbench\nDOM + Workbench]
    Worker[Web Worker Extension Host]
    IDB[(IndexedDB/浏览器文件授权)]
    Browser <--> Worker
    Browser <--> IDB
  end

  subgraph Remote[微软 VS Code Server / Remote Development]
    Server[server.main\nNode Server]
    Agent[Remote Extension Host Agent\nHTTP/WebSocket/PersistentProtocol]
    RemoteEH[Remote Extension Host\n远端 Node]
    RemoteDisk[(远端工作区/用户数据/扩展)]
    Server --> Agent
    Agent <--> RemoteEH
    Agent --> RemoteDisk
  end

  Browser <-->|WebSocket + auth/sign/connectionType| Agent
  Renderer <-->|Remote agent connection| Agent
```

**已验证**：`BrowserMain.open()` 先装配服务，再创建 `Workbench` 并调用 `startup()`；`server.main.ts` 计算远端 data/extension 目录并委托 `createServer()`；Server 连接在 `remoteExtensionHostAgentServer.ts` 中以 `PersistentProtocol` 承载控制帧和连接类型。**从源码推断**：上图把这些边界压缩成部署拓扑，未在本轮启动真实三种环境。

### 桌面启动时序

```mermaid
sequenceDiagram
  participant OS as OS/Electron
  participant Main as CodeMain
  participant IPC as Main IPC
  participant R as renderer
  participant D as DesktopMain
  participant W as Workbench
  participant EH as Extension Host

  OS->>Main: main() / startup()
  Main->>Main: createServices + initServices
  Main->>IPC: claimInstance(mainIPCHandle)
  Main->>Main: CodeApplication.startup()
  Main->>R: 创建窗口并传递 window configuration
  R->>D: import desktop.main / DesktopMain.open()
  D->>D: initServices + 等待 DOM
  D->>W: new Workbench(...).startup()
  W->>W: Ready；创建 Parts；创建布局；恢复状态
  W->>EH: 按运行位置惰性启动/握手
  W-->>OS: 可交互；Restored/Eventually 继续推进
```

**已验证**：`CodeMain.startup()` 的服务、初始化、单实例 IPC 和 `CodeApplication.startup()` 顺序；`DesktopMain.open()` 的服务初始化、DOM 等待、Workbench 创建和启动；`Workbench.startup()` 的服务、布局、注册表、渲染、恢复顺序。源码链接见 [01](./01-modules-bootstrap-di.md)。

## 来源账本

| 项目 | 固定值/边界 |
| --- | --- |
| 研究对象 | `microsoft/vscode`，release `1.133.0` |
| 实现快照 | `a5b500951314efd502d07465bd138dfbd714a960` |
| release 发布时间 | `2026-08-12T09:41:17Z`（按执行计划固定记录） |
| 本地复核 | `git rev-parse refs/tags/1.133.0^{commit}` 与固定 SHA 相等；`git cat-file -e <sha>^{commit}` 成功 |
| remote | `https://github.com/microsoft/vscode.git` |
| 源码目录 | `C:/Users/notnotype/Documents/CodeRepository/GithubProjects/vscode`；detached HEAD 固定 SHA |
| 源码链接规则 | 一律使用 `https://github.com/microsoft/vscode/blob/a5b500951314efd502d07465bd138dfbd714a960/<path>`，不使用 `main` |
| 官方文档入口 | [Architecture](https://code.visualstudio.com/docs/getstarted/architecture)、[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)、[Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)、[Contribution Points](https://code.visualstudio.com/api/references/contribution-points)、[Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)、[VS Code Server](https://code.visualstudio.com/docs/remote/vscode-server) |
| 第三方 code server 边界 | 不读取 `coder/code-server` 源码；本报告的“Server”只指微软 VS Code Server/Remote Development |

### 证据边界

- **已验证**：本地固定 commit 的源码路径、类/函数、配置键和状态字段；源码链接可复查。
- **从源码推断**：跨进程、跨模块的用户旅程；它们是根据调用方向和数据结构归纳，不等同于真实运行 trace。
- **未验证**：本轮没有构建或启动 VS Code，没有连接真实远端，没有安装 Marketplace 扩展，没有测量启动耗时，也没有读取 Marketplace/更新服务内部实现。故障 UI 文案、网络中间层部署和生产级性能只在源码直接显示的范围内陈述。
- 现有 [`../vscode-extension-system.md`](../vscode-extension-system.md) 保留扩展系统与 View/Panel 的浅层研究证据；本组专题只补端到端调用链、RPC、恢复和 NeuroBook 映射，不复制其正文。

## 用户旅程追踪矩阵

| 用户动作 | 主报告/图 | 固定 SHA 证据 | 成功链 | 失败触发与可见结果 | 文档验收动作 |
| --- | --- | --- | --- | --- | --- |
| 桌面打开一个 Workspace | [01 启动时序](./01-modules-bootstrap-di.md#旅程桌面打开一个-workspace)、启动时序图 | `src/vs/code/electron-main/main.ts::CodeMain.startup`；`src/vs/workbench/electron-browser/desktop.main.ts::DesktopMain.open`；`src/vs/workbench/browser/workbench.ts::Workbench.startup` | main 建服务 → 单实例 → renderer → Workbench 服务/Parts → 布局恢复 → 编辑器恢复 | data 目录初始化、服务缺失、循环依赖、窗口恢复异常会记录错误或中止关键启动；真实 UI 未验证 | 顺着图核对入口、宿主、服务、状态、失败节点 |
| 浏览器连接微软 Server | [02 Server 生命周期](./02-hosts-web-remote-server.md#连接生命周期) | `src/vs/workbench/browser/web.main.ts::BrowserMain.open`；`src/vs/server/node/server.main.ts::createServer`；`remoteExtensionHostAgentServer.ts::RemoteExtensionHostAgentServer._handleWebSocketConnection` | Web Workbench → authority resolver → auth/sign/connectionType → Management/ExtensionHost channel → 远程文件/终端 | server 不在、token 错、commit mismatch、重连 token 无效、Tunnel 失败；源码错误原因已列，真实页面未验证 | 逐项核对连接表和失败表 |
| Ctrl+P 打开文件 | [04 Quick Access](./04-quick-access-commands.md#旅程输入文件名打开资源) | `src/vs/workbench/browser/parts/editor/editorQuickAccess.ts`；Quick Access Registry；`EditorService` | keybinding → Quick Access provider → 模糊匹配 → URI → EditorInput → EditorPane/model | provider 无结果、URI 无 provider、打开失败触发 `onDidOpenEditorFail`；未实机验证 | 检查输入、provider、EditorInput、失败事件是否闭环 |
| Ctrl+Shift+P 执行内置命令 | [04 命令旅程](./04-quick-access-commands.md#旅程输入--搜索并执行内置命令) | `src/vs/platform/commands/common/commands.ts::CommandsRegistry`；`src/vs/workbench/services/commands/common/commandService.ts::CommandService.executeCommand` | `>` provider → command metadata → `CommandsRegistry` → `ICommandService` → handler | 未注册命令先触发 activation，最终仍找不到时报 `command '<id>' not found` | 核对 command/menu/keybinding/context key 分层 |
| 读取、写入并监听配置 | [05 配置](./05-configuration-system.md#旅程同一个设置键的最终值) | `configuration.ts::ConfigurationTarget`；`configurationModels.ts::Configuration`/`ConfigurationInspectValue`；`configurationService.ts::ConfigurationService.updateValue` | schema/default → policy/user/workspace/folder/memory 合并 → `getValue/inspect` → `ConfigurationEditing` → reload/event | policy 值不可写、非法 target、文件变更 reload；未实机验证 | 使用同一键核对每层和 change event |
| 打开、修改、保存和恢复文本文件 | [06 编辑器](./06-editor-architecture.md#旅程打开一个-uri-文件) | `EditorService`；`TextResourceEditorInput.resolve`；`AbstractTextResourceEditor.setInput`；`EditorPart` | URI → EditorInput → model reference → EditorPane → Monaco `ICodeEditor.setModel` → working copy save/backup | provider 缺失、解析类型错误、取消、保存取消/失败；源码链已验证，真实 UI 未验证 | 核对 input/model/pane/group 和脏状态路径 |
| 移动侧栏/Panel 位置 | [03 布局](./03-workbench-layout-views.md#旅程移动一个-view-container) | `layoutService.ts::Parts/Position/PanelAlignment`；`Layout`；`ViewDescriptorService.moveViewContainerToLocation` | 宿主命令 → Part/ViewContainer location → SerializableGrid/layout → Profile storage | 非法位置、Sessions window 禁止移动、恢复状态损坏；未实机验证 | 分别核对容器位置与 Part 几何 |
| 同容器内重排 View | [03 View](./03-workbench-layout-views.md#旅程同一容器内重排) | `ViewContainerModel`；`PaneView`；`CompositeDragAndDropObserver`（索引见 [10](./10-source-index-and-glossary.md)） | drag intent → 宿主校验 → ViewContainerModel 顺序/可见性 → Profile storage | 不可移动 View、目标不是同容器、空容器清理；未实机验证 | 检查排序不被误写成二维 Grid |
| 跨容器移动 View | [03 View](./03-workbench-layout-views.md#旅程跨容器迁移) | `ViewDescriptorService.moveViewsToContainer`；`views.customizations` | view → generated container/目标容器 → cleanup source → 保存 customizations | Sessions window 禁止；非法目标或扩展移除后回默认 | 核对 `viewLocations`、generated container 和回滚默认 |
| Split 编辑器 | [03 编辑器分屏](./03-workbench-layout-views.md#旅程编辑器分屏) | `editorPart.ts::EditorPart`；`SerializableGrid<IEditorGroupView>`；`editorpart.state` | split intent → EditorGroup → 二维 Grid → memento 恢复 | 最小尺寸、空组、恢复数据无效；未实机验证 | 确认与 Sidebar/Panel 一维模型分开 |
| 首次执行扩展 command | [07 扩展](./07-extension-system-deep-dive.md#旅程首次执行扩展-command) | `CommandService`；`mainThreadCommands.ts`；`ExtensionDescriptionRegistry`；`ExtensionsActivator` | manifest/command description → registry → `onCommand:<id>` → Extension Host → MainThread/ExtHost RPC → handler | 缺依赖、禁用、激活异常、宿主 crash/version mismatch；恢复链已验证，真实插件未安装 | 逐节点核对激活状态和 RPC |
| 首次打开扩展 View | [07 扩展 View](./07-extension-system-deep-dive.md#旅程首次打开扩展-view) | `AbstractExtensionService`；`ViewDescriptorService`；`PaneView`；`WebWorkerExtensionHost`/`RemoteExtensionHost` | View description 已登记 → UI 宿主创建 Pane → activation event → 扩展填充内容 | View 不可用、workspace trust、运行位置不可用、宿主失败 | 检查“先描述后激活”而非直接执行 |
| 当前章节请求生成一张角色插图 | [09 文生图压力测试](./09-text-to-image-plugin-journey.md#端到端时序) | NeuroBook `AgentJobManager.spawn`、`AgentToolRegistry`、`SessionAttachmentAuthority`、`recordProjectWrite`、`readConfigSnapshot` | 命令/View → 规划/schema → 权限 → durable job → Provider（候选）→ 资产/历史 → 正文刷新（候选） | schema 错、取消、Provider 失败、重复 job、外部修改、部分发布；既有能力与缺口逐项列出 | 任何“已支持文生图”表述均判失败 |

## 阅读顺序

1. [01 模块、启动与依赖注入](./01-modules-bootstrap-di.md)：回答“窗口为什么能起来”。
2. [02 浏览器、Node 与微软 Server](./02-hosts-web-remote-server.md)：回答“代码在哪台机器跑”。
3. [03 Workbench 布局、View 与分屏](./03-workbench-layout-views.md)：回答“哪些状态属于宿主布局”。
4. [04 Quick Access 与命令](./04-quick-access-commands.md)：回答“Ctrl+P/命令面板如何找到能力”。
5. [05 配置系统](./05-configuration-system.md)：回答“设置如何合并、写回、变更”。
6. [06 编辑器架构](./06-editor-architecture.md)：回答“文件如何从 URI 变成可编辑文本”。
7. [07 扩展系统深挖](./07-extension-system-deep-dive.md)：回答“首次调用插件发生什么”。
8. [08 NeuroBook 映射](./08-neurobook-mapping.md)：把机制转成渐进式观察框架，不生成产品合同。
9. [09 文生图旅程](./09-text-to-image-plugin-journey.md)：用复杂案例压力测试边界。
10. [10 源码索引与术语](./10-source-index-and-glossary.md)：按固定 SHA 复查。

## NeuroBook 当前事实（用于映射，不是建议合同）

- `server/agent/http.ts::useAgentHarness()` 提供 `globalThis` 单例入口，并配合构造器注入；没有 VS Code 式统一 IoC 容器。
- `AgentProfileCatalog`、Profile artifact、`ProfileRegistry.publish()`、`AgentToolRegistry`、Runtime Hook、资产安装 provenance 已提供若干控制平面零件；没有统一 Description Registry 或插件 activation state machine。
- `app/pages/index.vue` 与 `app/stores/novel-ide.ts` 仍以固定槽位和 local/session 持久化组织工作台；`app/composables/useResizablePanel.ts` 是唯一 resize 边界。
- `server/media/image-variant.ts::ImageVariantModule` 是受限图片变体处理先例（`MAX_ACTIVE_JOBS = 2`、`MAX_QUEUED_JOBS = 64`），不是 AI 生图 Provider，也不是通用 Project FIFO。

这些事实来自本轮读取的 NeuroBook 源码；跨模块“下一步应该如何解耦”集中写在 [08](./08-neurobook-mapping.md)，并标注研究置信度。

## 检查边界与状态

本组报告不修改产品代码、Spec、ADR 或现有扩展研究文件。没有在真实桌面、浏览器远程连接、第三方扩展安装、真实 Provider 或 Marketplace 上执行操作；因此所有旅程都是源码追踪验收，不冒充运行时 smoke。最终验收需要通过仓库文档检查、专题相对链接检查、固定 SHA 路径检查、矩阵逐行检查和七类核心图抽查。
