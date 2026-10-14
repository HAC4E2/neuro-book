# 10 份 planned Spec 的晋升复核

对照对象：`docs/specs/` 下 10 份仍为 `planned` 的行为 Spec，与 `packages/neuro-book`（新应用）、`packages/nb-runtime`（内核）的实际代码、测试与 e2e。方法：读 Spec 全文逐条输出/验收条目，`ls`/`grep`/`wc -l` 核对 Spec 中已经起草或声称的实现路径与测试文件是否真实存在，抽样读测试文件的 `describe` 标题确认它们确实对应 Spec 编号，再判断能否晋升。本报告只读仓库，未改动任何文件、未提交。

## 总表（结论先行）

| Spec | 建议 | 主要缺口 |
|---|---|---|
| `workbench/files-explorer.md` | 晋升（跨机器基础操作仍标注"未验证"，留在文中作为已知限制，不拆分新文件） | 跨机器/跨平台（非 Windows）基础操作未在隔离第二宿主上验证；dirty 文档结算依赖 `workbench.editor`，两者应同批晋升 |
| `workspace/files.md` | 晋升（同上，跨机器/跨平台未验证留作已知限制） | 同上；与 `workspace.resources`、`workspace.folder-kinds` 是同一实现里的三个切面，建议同批晋升 |
| `workspace/folder-kinds.md` | 晋升 | 活页夹的渲染、编号分配归"剧情插件"，该插件尚不存在——但这是 Spec 自己定义的职责分工与 fallback 行为，不是缺口；本 Spec 范围内的部分已全部实现并有测试 |
| `workspace/resources.md` | **不整体晋升**，建议拆分 | `project://`、`user://` 两个真实目录型提供者的读写列出监视、写入来源、变更事件、订阅已充分实现且测试详尽；但 `glob`、`grep`、bash 真实路径解析、`tmp://`/`local://`/`docs://`/`projects://` 四个方案、插件注册新方案的接口**全部未实现**（`nb-harness` 只有 `read`/`edit` 两个工具），验收场景 1、4 直接依赖这些，整份晋升会宣称不存在的能力 |
| `workbench/editor.md` | 晋升 | 已起草的 23 条测试文件全部存在；仅"继续写作"依赖书架页（另一个已实现 Spec），无新缺口 |
| `workbench/views.md` | 晋升（输出 7 标 `(planned)` 留在文中） | 输出 7（声明消失清理布局项）依赖插件管理的热插拔机制，`runtime.plugin-hot-plug` 本身是另一份仍 `planned` 的 Spec；Spec 正文已经自己标注"输出 7 要等…"，符合"已实现 Spec 加新行为标 (planned)"的写法 |
| `ui/workbench-shell.md` | 晋升 | 外壳一至四全部有真实合同测试与 e2e；非目标（编辑器拖放、桌面窗口控制）范围清晰，不构成缺口 |
| `runtime/browser-host.md` | **不整体晋升**，建议拆分 | 启动序列、断线重连、项目绑定、失败呈现主体已充分实现并测试；但懒激活（`onView` 触发入口激活）、插件集合订阅与热插拔联动、鉴权、第三方浏览器入口四项是 Spec 自己写明的"现状：尚未实现"，且核实后确认代码里确实没有 `onView:<id>` 触发逻辑 |
| `runtime/plugin-channel.md` | **建议开发者核对后晋升**（证据区的保留理由已过时） | 证据区写"本文保持 planned，进程间链路实现后再评估晋升"，但 `ipc.ts`、`manager.test.ts`、`server-projects.test.ts` 在该句写下的前一天（2026-10-07）就已提交，进程间链路实际已实现且有合同测试覆盖（场景 17）；末节"HTTP 路由贡献"应整节移出到 `nbook.http` 相关 Spec |
| `runtime/plugin-manifest.md` | **不晋升** | 本 Spec 的行为合同部分（受阻推导、依赖图、激活/关闭顺序、贡献校验）已被 `runtime.plugins`（已 `implemented`）完整覆盖和实现；但本 Spec 独有的部分——声明式 `package.json` 清单文件格式、`pluginVersions`/`version-mismatch` 的 semver 校验、`engines.neurobook`——完全未实现，当前插件全部是代码定义的 `PluginDefinition` 常量对象，没有任何清单文件 |

下文每份 Spec 一节，含逐条对照表与晋升用的"实现合同"与"证据"草稿文字（证据链接均已用 `ls`/`Read` 核对为仓库里真实存在的路径）。

---

## 1. `docs/specs/workbench/files-explorer.md`（`workbench.files-explorer`）

### 逐条对照

实现主体是 `packages/neuro-book/src/plugins/explorer/`（浏览器插件 `nbook.explorer`），测试 `describe` 标题直接写 `Spec workbench.files-explorer 验收 N` 或条目名，与 Spec 编号一一对应，不是推断。

| Spec 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 文件夹类型呈现（表格、根、清单文件显隐、按需加载） | `explorer/web/controller.ts`、`explorer/web/components/ExplorerTree.vue`、`web/tree/rows.ts` | `browse.test.ts` 的 `Spec workbench.files-explorer 验收 1、2：浏览`、`验收 2、3：点击与打开`、`增量刷新的依赖`（真实 Files 场地） | 已实现有测试 |
| 基础文件操作（多选、修饰键、碰撞、取消、结果未知） | `explorer/web/commands.ts`、`explorer/web/controller.ts` | `actions.test.ts`（新建/改名/删除/内容文件夹动作）、`transfer.test.ts` 的 `验收 5：复制与剪切`、`验收 6：粘贴目标与源`、`验收 7：碰撞`、`验收 4、8：切换显示与取消`、`验收 8、15：结果未知` | 已实现有测试 |
| 拖动（落点、半区反馈、停留展开、边缘滚动、拖到编辑区、动画） | `explorer/web/tree-drag.ts` | `transfer.test.ts` 的 `拖动：判定与提交`、`冻结的意图：迟到的结果与失效`；e2e `files-explorer.e2e.ts` 第 463、489、646、686、745 行起的 5 组（验收 25–28） | 已实现有测试（视觉收尾动画只在 e2e 的真实 Chrome 断言） |
| 行的样子（图标、根分节、类型后缀、状态图标、缩进参考线、隐藏 `.md` 扩展名） | `explorer/web/icons/file-icons.ts`、`explorer/web/icons/catppuccin.ts`、`explorer/shared/settings.ts`（`indentGuidesSetting`、`hideMarkdownExtensionSetting`） | `file-icons.test.ts`；e2e 第 571 行起一组（中文数字排序、去后缀、叶子节点、类型图标、设置即时生效，验收 21、23） | 已实现有测试 |
| 打开作品时揭示活动文件 | `explorer/web/controller.ts` 的揭示逻辑 | `browse.test.ts` 的"揭示一个地址"一例（真实 Files 场地）；e2e `editor-area.e2e.ts` 的"打开作品时资源管理器揭示一次恢复出的活动文件"（验收 17） | 已实现有测试 |
| 命令表（`nbook.files.*` 全部 id）、`when` 公开键、树内按键、右键菜单贡献点 `explorer.context` | `explorer/web/commands.ts`、`explorer/web/menu.ts`、`explorer/shared/contracts.ts` | `session.test.ts` 的"会话与命令"一组；e2e 第 267、337、367、415、598、812 行各一组（命令面板、纯键盘操作、F2/Delete、工具栏新建、右键菜单贡献项，验收 14、20、24） | 已实现有测试 |
| 持久化（`explorer.preferences`、`explorer.expanded`、`explorer.user-expanded`，按分支淘汰、读取失败与保存暂停） | `explorer/web/preferences.ts`、`explorer/web/session.ts` | `session.test.ts` 的"持久化：记录被外部改坏"、"按分支淘汰"、`验收 16：保存暂停时的重试与放弃`（真实 Storage 场地） | 已实现有测试 |
| 文档与体验（唯一正文入口、三选复制对话框、移动结算、删除确认） | `explorer/plugin.ts`（文档协调服务的使用方） | `documents.test.ts` 的 `Spec workbench.editor 输出 23/24/25`（验收 9） | 已实现有测试 |
| 打开与切换性能标准（1 秒开项目、16ms 切换、100/200ms 正文出现等） | `scripts/perf/files-perf.ts`、`scripts/perf/scenarios.ts` | `bun run perf:files`（生产构建、参考机器、本机 Chrome，验收 12） | 已实现有测试，但要求"生产构建 + 参考机器"的一次性测量运行，本次只读复核未重新执行 perf 脚本，无法证明最近一次结果仍达标——**建议晋升前让开发者确认最近一次 `perf:files` 报告仍在阈值内** |
| 跨机器基础操作（验收全文开头即声明"完整合同还要求跨机器基础操作，在未取得隔离第二宿主前不视为已验证"） | — | — | 未验证，Spec 正文已自己标注为已知限制 |

### 结论与建议

浏览、操作、拖放、UI 细节、命令化、持久化、与编辑器的结算，全部有真实内核/真实 Storage/真实 Chrome 的测试，且测试标题直接引用 Spec 的验收编号——这是本 Spec 作者按"验收先行"写的，覆盖率很扎实。唯一两处要开发者确认才能晋升：

1. 性能标准（验收 12）需要一次新鲜的 `bun run perf:files` 结果作为证据链接，而不是"脚本存在"；
2. 跨机器/跨平台（Windows 之外）基础操作未验证，Spec 正文已明确写成已知限制，不必拆分新文件，晋升后原样保留这条限制。

**建议：晋升**，把这两条限制保留在"验收与 Smoke"或"边界与兼容"里作为已知限制，不必因此继续 `planned`——这与 `menus.md`、`persistence.md` 等已 `implemented` Spec 里保留"已知限制"小节的写法一致。

### 实现合同（草稿）

- 公开入口：浏览器插件 `nbook.explorer`（`explorer/plugin.ts`、`explorer/web/plugin.ts`）；命令表见 `explorer/web/commands.ts`；右键菜单贡献点 `explorer.context`、剪贴板与拖动模型、持久化记录 `explorer.preferences`/`explorer.expanded`/`explorer.user-expanded` 见 `explorer/shared/contracts.ts`。
- owner 与依赖方向：`files-view`（资源管理器呈现）依赖 `workspace-files`（`nbook.files` 客户端，[`workspace.files`](../workspace/files.md)）与 `nbook.editor` 的文档协调服务（可选依赖，[`workbench.editor`](editor.md)）；资源管理器不持有文件字节或磁盘基线，只持有树投影、选择与剪贴板意图。
- 不变量：
  - 剪贴板与冻结的拖动/粘贴意图不跟随改名改写地址，源被改名或移走后旧意图失效（`transfer.test.ts` 的"冻结的意图"）；
  - 批量结果未知时复制/剪切/粘贴/拖动/删除全部不可用，直到用户明确放弃（`transfer.test.ts` 的"验收 8、15：结果未知"）；
  - 内容文件夹内的新建、改名、拖动排序只改清单、不移动或改名文件（`actions.test.ts` 的"内容文件夹的动作只改清单或排他创建"）；
  - 控制器活到入口停止，视图停放/重建只解绑再绑定，不丢树、选择与进行中的操作（`view-host.ts` 的寿命规则，`browse.test.ts`）。

### 证据（草稿）

- 批准依据：2026-09-26 开发者"可以，就这么做，收口"批准 [首版设计决策记录](../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#决策记录)；2026-10-02 [项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md#决策记录)；2026-10-12 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md) 第 5 节；2026-10-14 [t86 的四轮评审](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/README.md#决定)。
- 实现入口：[`plugins/explorer/plugin.ts`](../../../packages/neuro-book/src/plugins/explorer/plugin.ts)、[`plugins/explorer/web/`](../../../packages/neuro-book/src/plugins/explorer/web/)
- 合同测试：[`explorer/browse.test.ts`](../../../packages/neuro-book/src/plugins/explorer/browse.test.ts)、[`explorer/actions.test.ts`](../../../packages/neuro-book/src/plugins/explorer/actions.test.ts)、[`explorer/transfer.test.ts`](../../../packages/neuro-book/src/plugins/explorer/transfer.test.ts)、[`explorer/session.test.ts`](../../../packages/neuro-book/src/plugins/explorer/session.test.ts)、[`explorer/documents.test.ts`](../../../packages/neuro-book/src/plugins/explorer/documents.test.ts)、[`explorer/web/icons/file-icons.test.ts`](../../../packages/neuro-book/src/plugins/explorer/web/icons/file-icons.test.ts)
- Smoke：[`e2e/files-explorer.e2e.ts`](../../../packages/neuro-book/e2e/files-explorer.e2e.ts)、[`e2e/editor-area.e2e.ts`](../../../packages/neuro-book/e2e/editor-area.e2e.ts)（验收 17）、[`scripts/perf/files-perf.ts`](../../../packages/neuro-book/scripts/perf/files-perf.ts)（`bun run perf:files`，验收 12，要求生产构建、参考机器）

---

## 2. `docs/specs/workspace/files.md`（`workspace.files`）

### 逐条对照

实现主体是 `packages/neuro-book/src/plugins/files/`（后端插件 `nbook.files` 的 `backend`/`web` 两个入口）。测试 `describe` 标题直接写 `Spec workspace.files <小节>`，与 Spec 小节名一一对应。

| Spec 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 读取与保存：磁盘基线、UTF-8/BOM/CRLF、正文上限、条件保存、控制目录、根身份 | `files/backend/rooted.ts`、`files/backend/commit.ts` | `rooted.test.ts` 的 `读取与保存：包含校验与控制目录`、`读取与保存：加锁提交`；`files.test.ts` 的 `读取与保存：文本与上限` | 已实现有测试 |
| 文件操作表（`identify`/`realPath`/`create`/`createContent`/`rename`/`convert`/`move`/`copy`/`delete`/`cancel`） | `files/backend/entry-ops.ts`、`files/backend/operations.ts`、`files/shared/contracts.ts` | `entry-ops.test.ts` 的 `目录项与目标`、`排他新建与移动`、`复制`、`删除`；`operations.test.ts` 的 `新建与创建内容`、`改名与源身份` | 已实现有测试 |
| 排他提交（Linux `renameat2`/macOS `renamex_np`/Windows `MoveFileExW`） | `files/backend/exclusive.ts` | `exclusive.test.ts`（`Spec workspace.files 排他改名`） | 已实现有测试（Linux 上实测；macOS/Windows 原语按代码路径区分但未在对应平台跑过，见下文"已知限制"） |
| 批量预处理、逐项结果、停止与取消、大小上限 | `files/backend/batch.ts` | `batch.test.ts` 的 `批量预处理`、`批量删除与复制的部分完成`、`停止与取消`；`transport.test.ts` 的 `批量的大小上限：真实 WebSocket`、`正文上限：真实 WebSocket` | 已实现有测试 |
| 变更通知（写入来源、新建/改名/删除事件、订阅失同步） | `files/backend/changes.ts` | `changes.test.ts` 的四个 `describe`（写入来源、外部变化、自己写入的回声、订阅）；`operations.test.ts` 的"操作之后的外部变化" | 已实现有测试 |
| `project://`、`user://` 两份远程合同，三端入口统一行为 | `files/shared/contracts.ts`、`files/backend/plugin.ts`、`files/web/plugin.ts`、`files/web/client.ts` | `files.test.ts` 的 `读与列出：三种调用方经同一份合同`；`project-child.test.ts`（真实项目子进程） | 已实现有测试 |
| 跨机器基础操作（验收 1–9 的整体门禁，第二宿主） | — | — | 未验证，Spec 正文"验收与 Smoke"开头已自己标注 |
| Windows/macOS/非默认文件系统的排他改名回退路径 | `files/backend/exclusive.ts` 内的分支 | 无对应平台的 CI 运行证据 | 证据区已自述"Linux/macOS、其它文件系统及跨机器基础操作仍待验证"，与代码里按平台 `process.platform` 分支的事实一致，不是代码与文档冲突，是诚实的未验证标注 |

### 结论与建议

本 Spec 与 `workspace.resources`、`workspace.folder-kinds` 共享同一套测试文件（例如 `files.test.ts` 一个文件里三个 `describe` 分别对应三份 Spec），说明这三份 Spec 描述的是同一次实现切出来的三个切面；核心读写、批量、冲突、取消、清单同步、变更事件均已用真实内核实例、真实临时目录、真实 `fs.watch`、真实 WebSocket 覆盖，唯一缺口是 Spec 自己写明的跨机器/跨平台验证。

**建议：晋升**，与 `workspace.folder-kinds`、`workspace.resources`（拆分后的已完成部分，见下节）同批进行；跨机器与非 Linux 平台验证作为已知限制保留在文中。

### 实现合同（草稿）

- 公开入口：`nbook/plugins/files/shared/contracts.ts`（远程合同 `filesUserContract`/`filesProjectContract`、方法表、失败码 `FILES_FAILURES`、`TEXT_BUDGET_BYTES`/`encodedTextBytes`/`encodedBytes`）；浏览器客户端 `files/web/client.ts`、`filesKey`。
- owner 与依赖方向：`workspace-files` 拥有分区库之外的文件原语与远程服务；依赖内核的按调用方门面、远程服务与跨实例委托（同 `storage.persistence` 的依赖写法），服务端/项目入口依赖 [`platform.files`](../platform/files.md) 的受根约束原语与 `nbook.diagnostics`；浏览器入口只依赖 `filesKey`，不直接访问真实路径。
- 不变量：
  - 控制目录（项目根下 `.nbook`）在词法路径与解析符号链接后的真实路径两处都拒绝（`rooted.test.ts`）；
  - 条件保存与排他改名在系统调用层核对身份，核对与系统调用之间的窗口不承诺抵御恶意并发替换（`rooted.test.ts`、`exclusive.test.ts`）；
  - 批量操作的源按目录项去重、父子重叠只处理最外层一次，移动/复制到自身或后代在产生任何结果前拒绝（`batch.test.ts`）；
  - 内容文件夹内的操作与清单更新在同一次操作里结算，文件已改而清单未改时返回部分完成并指明哪份清单（见 `workspace.folder-kinds` 的"经文件服务的操作同步清单"，`operations.test.ts`）；
  - 结果编码超预算时按路径→详情→清单表的顺序截断，每步重新核对装进一条消息（`transport.test.ts`）。

### 证据（草稿）

- 批准依据：2026-09-26 开发者"可以，就这么做，收口"批准 [首版设计决策记录](../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#决策记录)（F1–F9）；2026-10-02 [项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md#决策记录)；2026-10-14 [t86 的决定](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/README.md#决定)（`realPath`、叶子标记、移动到指定位置）；[w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 的 t68、t69 条目需要开发者补一次正式追认（文中已写"按推荐先做，待开发者追认"，晋升前宜一并清掉这条待办）。
- 实现入口：[`plugins/files/backend/`](../../../packages/neuro-book/src/plugins/files/backend/)、[`plugins/files/web/`](../../../packages/neuro-book/src/plugins/files/web/)、[`plugins/files/shared/contracts.ts`](../../../packages/neuro-book/src/plugins/files/shared/contracts.ts)
- 合同测试：[`files/files.test.ts`](../../../packages/neuro-book/src/plugins/files/files.test.ts)、[`files/operations.test.ts`](../../../packages/neuro-book/src/plugins/files/operations.test.ts)、[`files/batch.test.ts`](../../../packages/neuro-book/src/plugins/files/batch.test.ts)、[`files/changes.test.ts`](../../../packages/neuro-book/src/plugins/files/changes.test.ts)、[`files/transport.test.ts`](../../../packages/neuro-book/src/plugins/files/transport.test.ts)、[`files/project-child.test.ts`](../../../packages/neuro-book/src/plugins/files/project-child.test.ts)、[`files/backend/rooted.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/rooted.test.ts)、[`files/backend/entry-ops.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/entry-ops.test.ts)、[`files/backend/exclusive.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/exclusive.test.ts)
- Smoke：不适用——首版未在隔离第二宿主上验证跨机器基础操作；单机双窗口、Lab 与切换性能的记录见 [w00017 t16–t25](../../../.agents/works/w00017-application-runtime-architecture/README.md#当前-task-与继续条件)

---

## 3. `docs/specs/workspace/folder-kinds.md`（`workspace.folder-kinds`）

### 逐条对照

| Spec 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 三类文件夹识别（后缀判断，不读目录内容） | `files/backend/folder-kinds.ts` | `files.test.ts` 的 `列出：三类文件夹` | 已实现有测试 |
| 名字排序（中文自然排序 + 中文数字换算） | `files/shared/names.ts` | `names.test.ts`（`Spec workspace.folder-kinds 名字排序：中文数字`） | 已实现有测试 |
| 清单读取与校验、正文入口（有无正文/叶子标记） | `files/backend/manifests.ts`、`files/backend/folder-kinds.ts` | `files.test.ts` 同上；`operations.test.ts` 的"清单失败与操作锁"、"清单失败的失败码与交错改名" | 已实现有测试 |
| 经文件服务的操作同步清单（新建/改名/移入/移出/删除/复制） | `files/backend/manifest-edit.ts`、`files/backend/operations.ts` | `operations.test.ts` 的"转换"、"清单编辑"；`batch.test.ts` 的"批量的清单维护" | 已实现有测试 |
| 操作锁（跨进程、按方案根、整根一把） | `files/backend/exclusive.ts`（锁）、`files/backend/operations.ts` | `batch.test.ts` 的"操作锁：并发的操作"；`operations.test.ts` 的"清单失败的失败码与交错改名" | 已实现有测试 |
| 转换（加/去 `.content` 后缀，保留既有清单） | `files/backend/operations.ts` | `operations.test.ts` 的"转换" | 已实现有测试 |
| 渲染贡献点（未认领后缀按普通文件夹显示并提示） | `files/backend/folder-kinds.ts`（服务端判定）；渲染侧在 `workbench.files-explorer` | 服务端部分见上；渲染侧见 `explorer/actions.test.ts` 的"内容文件夹的动作只改清单或排他创建" | 已实现有测试；活页夹（`.binder`）目前没有"剧情插件"去认领，这是 Spec 自己定义的职责分工（"活页夹的清单维护、编号分配与渲染归剧情插件"），不是本 Spec 范围内的缺口 |
| 外部改动不同步清单（未列入/缺失兜底） | `files/backend/manifests.ts` | `files.test.ts` 的"列出：三类文件夹"覆盖未列入与缺失场景 | 已实现有测试 |

### 结论与建议

本 Spec 的职责边界写得很清楚：活页夹的语义、编号分配与渲染"随剧情插件改造另定"，不是本 Spec 要交付的范围；本 Spec 范围内（普通/内容文件夹的识别、排序、清单读写、经文件服务的同步、操作锁、转换）全部有测试，且测试文件与 `workspace.files` 共享、互相印证实现的一致性。

**建议：晋升。**

### 实现合同（草稿）

- 公开入口：清单解析与编辑在 `files/backend/manifests.ts`、`files/backend/manifest-edit.ts`；名字排序 `files/shared/names.ts` 的排序比较器（经 `files/shared/contracts.ts` 导出目录项 `EntrySchema` 的 `listed`/`body`/`leaf`/`role` 字段）；渲染贡献点随 [`workbench.files-explorer`](../workbench/files-explorer.md) 的后缀认领机制。
- owner 与依赖方向：`workspace-files` 拥有类型识别、内容文件夹清单与渲染贡献点；依赖 [`workspace.files`](files.md) 的操作管道（经同一次操作提交文件与清单）；活页夹的清单维护、编号分配与渲染归属尚不存在的"剧情插件"，这是声明的未来依赖方向，不是当前实现的缺口。
- 不变量：
  - 一个内容文件夹只在根上放一份清单，子目录不再有自己的清单（`files.test.ts`）；
  - 清单不合法或读不出时该文件夹退回普通文件夹显示，不改写清单（`operations.test.ts` 的"清单失败"系列）；
  - 经文件服务的子项操作与清单更新在同一次操作内结算，任一步失败时清单原字节不变、结果标明哪份清单未更新（`operations.test.ts`、`batch.test.ts`）；
  - 跨两个内容树的移动由整根跨进程操作锁覆盖，交错改名场景下清单与磁盘最终一致（`operations.test.ts` 的"清单失败的失败码与交错改名"）。

### 证据（草稿）

- 批准依据：[项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)（`accepted`，2026-10-02）的"分项决定"与方案第 2 节；名字排序中文数字与正文入口、叶子标记依据 [t86 的决定](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/README.md#决定)（2026-10-14 确认）；清单编辑、操作锁与转换时保留已有清单依据 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 的 t69 条目（同上，建议晋升前请开发者补一次正式追认）。
- 实现入口：[`plugins/files/backend/folder-kinds.ts`](../../../packages/neuro-book/src/plugins/files/backend/folder-kinds.ts)、[`plugins/files/backend/manifests.ts`](../../../packages/neuro-book/src/plugins/files/backend/manifests.ts)、[`plugins/files/backend/manifest-edit.ts`](../../../packages/neuro-book/src/plugins/files/backend/manifest-edit.ts)、[`plugins/files/shared/names.ts`](../../../packages/neuro-book/src/plugins/files/shared/names.ts)
- 合同测试：[`files/files.test.ts`](../../../packages/neuro-book/src/plugins/files/files.test.ts)、[`files/operations.test.ts`](../../../packages/neuro-book/src/plugins/files/operations.test.ts)、[`files/batch.test.ts`](../../../packages/neuro-book/src/plugins/files/batch.test.ts)、[`files/shared/names.test.ts`](../../../packages/neuro-book/src/plugins/files/shared/names.test.ts)
- Smoke：不适用——本能力没有独立的 e2e 入口，经 `workbench.files-explorer` 的 [`e2e/files-explorer.e2e.ts`](../../../packages/neuro-book/e2e/files-explorer.e2e.ts) 间接覆盖（内容文件夹展示与拖动排序场景）

---

## 4. `docs/specs/workspace/resources.md`（`workspace.resources`）

### 逐条对照

| Spec 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 资源地址解析（`方案://路径`，段规则、字节上限） | `files/shared/resource.ts` | `resource.test.ts`（`Spec workspace.resources 资源地址`） | 已实现有测试 |
| `project://`、`user://` 的读/列出/监视（真实目录型提供者） | `files/backend/files-service.ts`、`files/backend/plugin.ts` | `files.test.ts` 的"读与列出：三种调用方经同一份合同" | 已实现有测试 |
| 写入来源（按调用方身份：user/system/agent/external） | `files/backend/changes.ts` | `changes.test.ts` 的"写入来源：按调用方身份" | 已实现有测试（agent 来源依赖 nb-harness，见下） |
| 变更事件（新建/修改/改名/删除，前缀覆盖后代） | `files/backend/changes.ts` | `changes.test.ts` 的"变更事件：外部变化"、"变更事件：自己写入的回声"；`operations.test.ts` 的"变更事件：操作之后的外部变化" | 已实现有测试 |
| 订阅（就绪、失同步、断线重连不补发） | `files/backend/changes.ts` | `changes.test.ts` 的"订阅：共享、释放与失同步" | 已实现有测试 |
| `project://` 在真实项目子进程里 | `files/backend/plugin.ts`（项目入口） | `project-child.test.ts`（`项目子进程里的 project://`） | 已实现有测试 |
| **能力矩阵的 glob、grep** | — | — | **未实现**：`files/shared/contracts.ts`、`files/backend/files-service.ts` 均无 glob/grep 方法；Spec 自己也写"glob 与 grep 的能力模型待讨论…本表虚拟提供者一列的写法在讨论结论前不实施"，但真实目录型的 glob/grep（Spec 表格写"支持"）同样没有实现 |
| **bash 真实路径解析** | — | — | **未实现**：`nb-harness/src/tools` 只有 `read.ts`、`edit.ts` 两个工具，没有 bash 工具；无法核对"工作目录为 `local://`"等行为 |
| **`tmp://`、`local://`、`docs://`、`projects://` 四个方案** | — | — | **未实现**：`files/shared/resource.ts` 的 `SCHEMES = ["project", "user"]`，只有两个方案；Spec 自己标注这四个"随 nb-harness 实现"，核实 `nb-harness` 目录下确无对应 provider |
| **插件注册新方案的接口（第三方提供者）** | — | — | **未实现**：全仓库搜不到 `registerScheme`/`registerProvider` 一类接口；Spec 自己标注"随第一个插件方案（剧情插件的 `plot://`）实现"，剧情插件不存在 |
| 只读方案拒绝写入、`user://` 对 Agent 默认只读 | — | — | 无法核对：`docs://` 与 Agent 访问控制都依赖上面两条未实现的能力 |

### 结论与建议

本 Spec 写的"实现顺序"小节其实已经交代了真实情况：首版只做 `project://`/`user://` 两个真实目录型提供者的读、条件保存、列出与监视，"其余方案、插件注册新方案的接口与虚拟提供者、glob 与 grep 随各自的第一个使用方实现"。核实下来，"首版"范围（两个真实方案的核心操作、写入来源按调用方身份、变更事件、订阅）确实做完且测试详尽；但"其余方案"目前是**完全空白**，不是部分实现——没有 glob、没有 grep、没有 bash 工具、没有 `tmp://`/`local://`/`docs://`/`projects://`、没有第三方方案注册接口。Spec 的验收场景 1（"对 `project://`、`user://`、`tmp://`、`local://`、`docs://` 分别读、列出、glob、grep"）与验收场景 4（虚拟方案注册）因此都跑不起来。

**不建议整份晋升**。两个可行方向：

1. **拆分**：把本 Spec 收窄为只覆盖 `project://`/`user://` 两个真实目录型提供者已完成的部分（资源地址、写入来源、变更事件、订阅），晋升这部分；"能力矩阵""glob/grep""插件注册新方案"移到一份新的 `planned` Spec（或保留在本文但整节标 `(planned)`，参照 README"已实现的 Spec 加新行为"写法）。
2. **保持 planned**：等 `nb-harness` 把 Agent 文件工具（含 glob/grep/bash）与剩余方案落地后一次性晋升，避免晋升后又要在"已实现"的文件里大段补写新能力。

综合考虑"两种成熟度，一个文件"的原则（不建 `*-draft.md`/`*-current.md`），**倾向方案 1**：先晋升已完成的核心闭环，用整节 `(planned)` 标记清楚区隔未完成部分，比继续让整份 Spec 停留在 `planned`（掩盖已经相当扎实的真实目录型提供者实现）更准确。但这改变了 Spec 文件结构（拆一节出去），属于产品范围判断，**建议交开发者决定**，本报告不代为决定。

### 实现合同（草稿，仅覆盖建议拆分后的已完成部分：`project://`/`user://` 真实目录型提供者）

- 公开入口：`files/shared/resource.ts`（`parseResource`、`Resource`、`Scheme`、`SCHEMES`）；写入来源与变更事件经 `files/shared/contracts.ts` 的事件 schema。
- owner 与依赖方向：`workspace-files`（内置插件 `nbook.files`）；真实目录型提供者的根访问按 [`platform.files`](../platform/files.md) 的包含、链接与身份规则，由 `nbook.files` 自己的受根约束原语提供（尚无独立的平台文件插件，Spec 本身也写"随第二个使用方出现"）。
- 不变量：
  - 调用方不能自称来源，来源完全由提供者按内核签发的调用方身份确定（`changes.test.ts` 的"写入来源：按调用方身份"）；
  - 文件服务自己写入的回声按真实路径的预期状态判定、不重复以外部来源发出（`changes.test.ts` 的"自己写入的回声"）；
  - 监视器报错、事件队列溢出或断线重连都推"失同步"而不是静默丢事件（`changes.test.ts` 的"订阅：共享、释放与失同步"）。

### 证据（草稿，同上收窄范围）

- 批准依据：[项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)（`accepted`，2026-10-02）的"分项决定"与方案第 1、3、8 节；来源按调用方身份、外部事件只分修改与删除：[w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 的 t68 条目（待开发者正式追认）。
- 实现入口：[`plugins/files/shared/resource.ts`](../../../packages/neuro-book/src/plugins/files/shared/resource.ts)、[`plugins/files/backend/changes.ts`](../../../packages/neuro-book/src/plugins/files/backend/changes.ts)
- 合同测试：[`files/shared/resource.test.ts`](../../../packages/neuro-book/src/plugins/files/shared/resource.test.ts)、[`files/changes.test.ts`](../../../packages/neuro-book/src/plugins/files/changes.test.ts)、[`files/project-child.test.ts`](../../../packages/neuro-book/src/plugins/files/project-child.test.ts)
- Smoke：不适用——没有独立 e2e，经 `workspace.files`/`workbench.files-explorer` 的 e2e 间接覆盖资源读写部分

---

## 5. `docs/specs/workbench/editor.md`（`workbench.editor`）

本 Spec 的"证据"一节此前已经按格式起草（见 Spec 正文第 236–242 行），本节工作是核实每条引用的文件是否真实存在、测试标题是否真对应到输出编号——结果是逐条都对得上，这是目前 10 份里证据最完整的一份。

### 逐条对照（按输出编号分组，与测试 `describe` 标题的编号一一对应）

| 输出编号 | 内容 | 实现位置 | 测试 | 判定 |
|---|---|---|---|---|
| 1–5 | 编辑组与标签（preview/permanent、拆分、关闭、会话快照） | `editor/web/groups/`（组模型） | `groups/groups.test.ts` 的"输出 1""输出 2–3""输出 5" | 已实现有测试 |
| 6–10 | 打开与切换（当帧切换、800ms 进度条、迟到结果丢弃、光标/滚动/撤销按组保留） | `editor/web/area.ts` | `area.test.ts` 的"输出 6–8" | 已实现有测试 |
| 11–18 | 文档模型（并发打开、输入回执、未裁决输入、保存排队、磁盘冲突、改名/删除/订阅结束） | `editor/web/documents/store.ts` | `documents.test.ts` 的"输出 11""输出 12–13""输出 14–15""输出 16""输出 17–18" | 已实现有测试 |
| 19 | Markdown 富文本往返不改字节、方言语义保持 | `editor/web/markdown/` | `markdown-dialect.test.ts`、`source-merge.test.ts` | 已实现有测试 |
| 21–25 | 离开确认、资源管理器结算（复制三选、移动租约、删除确认） | `editor/web/area.ts`、文档协调服务 | `area.test.ts` 的"输出 21–22""输出 4、13"；`documents.test.ts` 的"输出 22–25" | 已实现有测试 |
| 26–28 | 状态栏三条目（未保存数、字数、光标位置） | `editor/web/`（状态栏贡献） | `status-items.test.ts`；`shared/word-count.test.ts` | 已实现有测试 |
| 29 | 继续写作（地址参数、可取消的定位过程） | `editor/continue-writing.ts` | `continue-writing.test.ts`；`area.test.ts` 的"输出 29" | 已实现有测试 |
| 30–31 | 上次的光标、最近打开记录 | `editor/web/area.ts`、`editor/recent.ts` | `area.test.ts` 的"输出 30–31"；`recent.test.ts`；`groups.test.ts` 的往返一例 | 已实现有测试 |
| 32 | 空编辑组的提示（命令过滤、按键、位置、语言） | `editor/empty-tips.ts` | `empty-tips.test.ts` | 已实现有测试 |
| 33 | 页面标签（`editor.pages`，不进会话快照） | `editor/web/area.ts` | `area.test.ts` 的"输出 33"；`groups.test.ts` 的"页面标签不进快照" | 已实现有测试 |
| 34 | 编辑区标题动作（贡献点 `editor.title`，按钮上限、菜单身份） | `editor/title-actions.ts` | `title-actions.test.ts` | 已实现有测试 |
| 35 | 指定编辑组（`group` 参数、`data-editor-group`） | `editor/web/groups/` | `groups.test.ts` 的"输出 35"；`area.test.ts` 的"输出 35" | 已实现有测试 |

验收 1–21（含状态栏、继续写作、页面标签、编辑区标题的 e2e 场景）由 `editor-area.e2e.ts`、`bookshelf-stats.e2e.ts`、`welcome.e2e.ts`、`lab-editor.e2e.ts` 覆盖，均已核实文件存在。

### 结论与建议

这份 Spec 的"不承诺"一节（拖动标签换组、自动保存、预读等）写得很克制，范围内的全部输出都有对应实现与测试，且没有发现类似 `workspace.resources` 那种"验收场景引用了不存在能力"的问题——"继续写作"（输出 29）依赖 `workbench.bookshelf` 的地址参数来源，但 `workbench.bookshelf` 本身也不在这次要晋升的 10 份名单里（它应该已经是实现状态或另有计划），不构成本 Spec 的缺口。

**建议：晋升。**

### 实现合同、证据

Spec 正文已经起草好且本次核实全部通过，不需要改写；唯一建议是把正文里"批准依据"提到的 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) t71 条目（输出 30–33 等）在晋升前请开发者正式追认一次（文中写"按推荐先做，待开发者追认"）。

---

## 6. `docs/specs/workbench/views.md`（`workbench.views`）

本 Spec 正文已经自带"实现合同"与部分"证据"（第 164–175 行），且已在条目 0 处自述"输出 1–6、8、9 已实现；输出 7…现在只在纯模型里有规则"。核实如下。

### 逐条对照

| 输出编号 | 内容 | 实现位置 | 测试 | 判定 |
|---|---|---|---|---|
| 1–6、8、9 | 注册表、交付状态、首次有效可见加载、加载门禁、三种失败分开、撤回只卸载、`window.plugins`、`visible`/`location` | `workbench/web/views/registry.ts` | `views/registry.test.ts`（真实内核：从未交付、受阻、激活失败与重试、停止、加载中停止、拥有者停止） | 已实现有测试 |
| 7 | 声明消失时清理布局项 | — | — | **未实现**：Spec 自己写"要等插件管理提供声明消失的来源，现在只在纯模型里有规则"；核实 `runtime.plugin-hot-plug`（插件管理的热插拔）本身也在"待实现规范"表里，仍是 `planned`，依赖关系属实，不是文档过时 |
| 10 | 标题动作（`placement`、"⋯"下拉、实例参数） | `workbench/web/commands/view-commands.ts` | `workbench/view-actions.test.ts` | 已实现有测试 |
| 11 | 别的插件贡献的标题动作（贡献点 `workbench.view-title`，按钮上限 8、菜单身份） | 同上 | `view-actions.test.ts`；e2e `workbench-views.e2e.ts` 的"视图自己的按钮在前、贡献的在后……" | 已实现有测试 |

### 结论与建议

本 Spec 的写法已经示范了 README 里"已实现的 Spec 加新行为"的格式——它没有把输出 7 隐藏起来，而是在条目 0 直接说明哪条还没做。这正是晋升为 `implemented` 后、输出 7 应该继续保留的标法（文末追加"（planned）"即可，不必等插件管理做完才晋升主体）。

**建议：晋升**，输出 7 保留 `(planned)` 标记直到 `runtime.plugin-hot-plug` 落地。

### 实现合同、证据

Spec 正文第 164–175 行已经写好"实现合同"与大半"证据"，本次核实全部路径存在（`web/views/registry.ts`、`WorkbenchViewInstances.vue`、`WorkbenchViewFrame.vue`、`web/host/window-plugins.ts`，以及 `view-actions.test.ts`、`views/registry.test.ts`、`workbench-views.e2e.ts`、`files-explorer.e2e.ts`）。唯一要补的是"批准依据"一行已经写了（t79 计划 + 外壳设计稿），不需要改写。

---

## 7. `docs/specs/ui/workbench-shell.md`（`ui.workbench-shell`）

本 Spec 体量最大（409 行），按"外壳一（外壳与布局）""外壳二（容器与视图）""外壳三（拖放）""外壳四（标题栏、状态栏与条目）"加"无项目首页""工作台打磨""活动栏底部条目与页面浮层"七个切片写，每个切片的"输出"小节开头都自述"已实现"。正文已经起草了完整的"实现合同"（第 390–402 行）与"证据"（第 404–409 行），本次逐条核实引用路径。

### 逐条对照（按切片分组）

| 切片 | 输出编号 | 实现位置 | 测试 | 判定 |
|---|---|---|---|---|
| 外壳一 | 1–14（拓扑、面板位置、尺寸夹取、紧凑呈现、四种消失、恢复与键盘、Part 显隐、内容槽停放、公开状态、布局恢复） | `workbench/web/shell/`、`web/state/layout-store.ts`、`web/state/public-state.ts`、`web/commands/panel-commands.ts`、`WorkbenchShellLayout.vue`、`WorkbenchShell.vue` | `web/shell/layout.test.ts`、`web/state/layout-store.test.ts`、`web/commands/panel-commands.test.ts`，组件测试 `WorkbenchShellLayout`/`WorkbenchPanelSurface`/`WorkbenchStatusBar` 的 `.dom.test.ts` | 已实现有测试 |
| 外壳二 | 15–18、24–27（ActivityBar/Switcher、容器模式、动作顺序、实例保留、移动到、Panel 标签行、起源声明消失、焦点 Part） | `workbench/web/views/`、`web/commands/view-commands.ts`、`WorkbenchViewInstances.vue`、`WorkbenchToolPartHost.vue` | `web/views/model.test.ts`、`web/views/container-grid.test.ts`、`web/commands/view-commands.test.ts`、`layout-store.test.ts` 外壳二一组，组件测试 `WorkbenchShellParts.dom.test.ts` | 已实现有测试 |
| 外壳三 | 19–23（拖放行为表、方向与命中、半区分配、拖影反馈、键盘拖放） | `workbench/web/views/drop.ts`、`drop-dom.ts`、`drag-session.ts`、`patch.ts`、`WorkbenchDragFeedback.vue` | `web/views/drop.test.ts`、`web/views/dnd-model.test.ts`、`layout-store.test.ts` 的保存冲突两例、`view-commands.test.ts` 的 `newContainerIn` | 已实现有测试 |
| 外壳四 | 28–35（标题栏结构、应用菜单、逐级让位、菜单键盘、Part 可见切换、条目贡献点、溢出、状态栏） | `workbench/web/titlebar/`、`web/items/`、`WorkbenchTitleBar.vue`、`WorkbenchItemStrip.vue`、`shared/items.ts` | `titlebar-menu.test.ts`、`titlebar/menu-model.test.ts`、`items/registry.test.ts`、`items/item-strip.test.ts`、`commands/part-commands.test.ts` | 已实现有测试 |
| 无项目首页 | 36–37（`workbench.home`、`/workbench`） | `web/home-slot.ts` | `web/home-slot.test.ts`，组件测试 `home-page.dom.test.ts` | 已实现有测试 |
| 工作台打磨 | 38–39（卡片/平铺由主题决定、空着的右栏与面板缺省不显示） | `web/shell/cards.ts` | `web/shell/cards.test.ts`、`layout-store.test.ts` 的"空着的右栏与面板"一组 | 已实现有测试 |
| 活动栏底部条目与页面浮层 | 40–41（`workbench.activitybar-items`、`workbench.overlays`） | `shared/items.ts`、`shared/overlays.ts`、`web/items/activity-items.ts`、`web/overlays.ts` | `activity-items.test.ts`（真实内核）、`web/overlays.test.ts`，组件测试 `WorkbenchShellParts.dom.test.ts`、`overlays.dom.test.ts`、`home-page.dom.test.ts` | 已实现有测试 |

Smoke 覆盖 `e2e/workbench-shell.e2e.ts`、`e2e/workbench-views.e2e.ts`、`e2e/workbench-dnd.e2e.ts`、`e2e/workbench-titlebar.e2e.ts`、`e2e/lab-item-strip.e2e.ts`、`e2e/bookshelf.e2e.ts`、`e2e/settings.e2e.ts`，均核实存在。

### 结论与建议

四个切片加三个追加特性，全部在正文里自述"已实现"，且本次核实的全部 40+ 个实现/测试文件路径都真实存在；非目标范围（编辑器拖放换组、桌面窗口控制、第三方可执行插件）写得清楚，不构成缺口。这是 10 份里证据链最长、也最完整的一份。

**建议：晋升。**

### 实现合同、证据

Spec 正文第 388–409 行已经是完整草稿，本次核实全部通过，不需要改写。唯一需要开发者过一遍的是"批准依据"段落列出的多轮 t79/t80/t82/t83 计划确认日期（2026-10-12、10-13），确认这些是否都已经是最终稿而非仍在评审中的草案。

---

## 8. `docs/specs/runtime/browser-host.md`（`runtime.browser-host`）

本 Spec 正文第 134–147 行已经起草"实现合同"，第 149–151 行起草"证据"。正文明确自述"现状：懒激活（场景 3）、插件集合的订阅与变化（场景 5、7 与场景 6 的插件集合部分）、鉴权与第三方浏览器入口尚未实现"。

### 逐条对照

| 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 启动序列 1–5（加载外壳、引导接口、首连握手、建立运行实例、激活工作台与挂载） | `web/boot.ts`、`web/mount.ts`、`web/host/window.ts`、`web/host/connection.ts` | `web/host/window.test.ts`（真实后端、真实 WebSocket：503、协议/插件版本不一致、结构错误、缺必需插件、装配失败） | 已实现有测试 |
| 断线与重连（含服务端已重启、项目已关闭、版本不一致四条终态） | `web/host/remote-session.ts` | `remote-session.test.ts`（退避间隔、重取引导）；`window.test.ts` 的离线/重连、8、9 组 | 已实现有测试 |
| 窗口关闭（依赖逆序停止、尽力而为） | `web/host/window.ts` | `window.test.ts` 的"卸载后服务端收到终止并不再列出旧实例" | 已实现有测试 |
| 项目绑定（`?project=` 握手绑定、宽限期重连、`project-gone`） | `web/host/window.ts`（`windowProjectKey`） | "窗口绑定项目一组"（真实服务端与项目子进程） | 已实现有测试 |
| 失败呈现（宿主页六种、`windowRescueKey` 抢救未保存正文） | `FailurePage.vue`、`web/host/window.ts` | `FailurePage.dom.test.ts`、`mount.dom.test.ts` | 已实现有测试 |
| 加载页跟随上次明暗 | `web/host/appearance-hint.ts` | `appearance-hint.dom.test.ts` | 已实现有测试 |
| **场景 3：懒激活（`onView` 触发所属入口）** | — | — | **未实现**：全仓库搜索 `onView:` 触发逻辑找不到对应实现，与 Spec 自述"现状"一致 |
| **场景 5、7：插件集合的订阅与热插拔联动** | — | — | **未实现**：`runtime.plugin-hot-plug` 本身仍是 `planned`（见"待实现规范"表），依赖关系属实 |
| **鉴权、第三方浏览器入口** | — | — | **未实现**：登录插件未实现，`runtime.plugin-code-loading` 同样仍是 `planned` |

### 结论与建议

主体（挂载前建立实例、引导失败、多窗口隔离、离线重连、刷新与服务端重启、项目绑定与重连、加载页）有真实后端 + 真实 WebSocket + 真实项目子进程的测试覆盖，且核实后确认这些测试不是"空跑过"而是真的覆盖了对应场景编号。但场景 3、5、7 与鉴权/第三方入口是 Spec 正文自己承认、且经核实确实未实现的部分，验收编号里明确写着这几条。

**不建议整份晋升**，建议：

1. 把场景 3、5、7 与"鉴权""第三方浏览器入口"相关的输出条目标 `(planned)`，随 `runtime.plugin-hot-plug`、登录插件、`runtime.plugin-code-loading` 落地后去标记（与 `workbench.views` 输出 7 同样的处理方式）；
2. 晋升其余已完整实现、测试详尽的主体部分。

这与 `workbench.views` 的情况几乎一样：实现与文档高度吻合，只是个别输出条目诚实地写明"还没做"，晋升时保留这个诚实标注即可，不必继续整份 `planned`。

### 实现合同、证据

Spec 正文第 134–151 行已经是详尽草稿，本次核实全部引用路径（`main.ts`、`boot.ts`、`mount.ts`、`router.ts`、`window.ts`、`remote-session.ts`、`client-identity.ts`、`appearance-hint.ts`、`browser-host.ts`、`connection.ts`、`rpc-socket.ts`、`plugins.ts`、`development-plugins.ts`、`browser-bootstrap.ts`（前后端两份）以及对应的 11 个测试文件与 3 个 e2e 文件）均存在。建议晋升时在"现状"小节基础上，把仍未实现的场景改写成正文里带 `(planned)` 标记的条目，而不是整节放在"边界与兼容"的散文里（便于 `docs:check` 机检识别）。

---

## 9. `docs/specs/runtime/plugin-channel.md`（`runtime.plugin-channel`）

本 Spec 正文第 220–233 行已经起草"实现合同"与"证据"，且证据区列出了场景 1–22 的详尽测试映射。但证据区最后一句写"本文保持 `planned`，进程间链路实现后再评估晋升"，这与代码时间线核对后发现**已经过时**。

### 逐条对照

| 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 调用、校验、任意实例可达、调用方不可伪造 | `@notnotype/nb-runtime/remote`（`remote.ts`） | `protocol.test.ts`、`routing.test.ts`、`activation.test.ts`、`children.test.ts` | 已实现有测试 |
| 请求阶段与失败码、版本、按需激活与等待环、订阅 | 同上 | `protocol.test.ts`、`routing.test.ts` 各组 | 已实现有测试 |
| WebSocket 传输与握手（编码、端口与来源、握手六种拒绝、服务端重启、协议违规、停止） | 同上 + 服务端宿主的套接字适配 | `protocol.test.ts`、`json-codec.test.ts`、`routing.test.ts` 的握手/重连/协议违规/路由停止各组；真实 Chrome 由 `rpc.e2e.ts` 核对 | 已实现有测试 |
| **进程间链路（场景 17）** | `packages/neuro-book/src/server/projects/ipc.ts` | `server/projects/manager.test.ts`、`server/server-projects.test.ts` | **已实现有测试**——`ipc.ts` 由提交 `ac730fd18`（2026-10-07 13:39，提交信息"feat(t54): S4 项目子进程宿主、IPC 链路与项目管理器"）引入，早于 `plugin-channel.md` 本身最后一次修改（2026-10-08 17:01，`git log -1` 核实），即写下"进程间链路实现后再评估"这句话时，进程间链路代码已经在仓库里一天了 |
| 客户端身份与路由覆盖、经代理的远程调用、只取值、没有提供方、查询提供方 | 同上 | `routing.test.ts`、`delegation.test.ts`、`result.test.ts` | 已实现有测试 |
| 末节"HTTP 路由贡献" | — | — | Spec 自己标注"随 `nbook.http` 相关 Spec 移出"；这是范围声明，不是缺口，但晋升前应该真的移出去，否则一份 `implemented` Spec 里混着一节"待移交"的内容不符合"同一件事只在一处写正文"的原则 |

### 结论与建议

从场景编号到测试文件的映射本身没有问题，是 10 份里组织最严谨的一份（场景 1–22 全部有对应合同测试或 e2e，且本次逐一核实文件真实存在）。唯一的问题是证据区末尾那句保留 `planned` 的理由已经被代码事实推翻——核实发现写下这句话时进程间链路已经实现一天了，大概是撰写证据草稿时没有同步检查最新代码状态。

**建议：请开发者核对后晋升**；晋升时把"HTTP 路由贡献"一节正式移出到 `nbook.http` 相关 Spec（该 Spec 目前似乎还不存在，若暂时没有落点，至少应该在"待实现规范"表里给它留一行，而不是留在一份 `implemented` Spec 的末尾）。

### 实现合同、证据

Spec 正文第 220–233 行的草稿本次核实全部通过，只需把最后一句"本文保持 `planned`…"删掉（或改写为"进程间链路已实现，见 `ipc.ts`"）。

---

## 10. `docs/specs/runtime/plugin-manifest.md`（`runtime.plugin-manifest`）

### 逐条对照

| 条目 | 实现位置 | 测试 | 判定 |
|---|---|---|---|
| 输出 1–11（登记与目录、依赖只在同一运行实例内解析、受阻按入口计算、同一插件其它入口不受牵连、远程服务不构成依赖、插件汇总状态、激活/关闭顺序、登记顺序无语义、贡献校验、顶层声明式贡献） | `packages/nb-runtime/src/plugins/`（`PluginDefinition` 等） | 核实 `runtime.plugins`（已 `implemented`）的输出 11–22 条正是这些行为的测试覆盖——本 Spec 第 129 行自己写"代码定义的插件…已按本合同的入口…工作，行为见 `runtime.plugins` 输出第 11–22 条" | **行为已实现，但实现与测试落在 `runtime.plugins` 名下，不在本 Spec 名下** |
| **清单文件格式（`package.json` 的 `entries`/`contributes`/`contributionPoints`/`activationEventPrefixes`/`pluginVersions`）** | — | — | **未实现**：全仓库没有任何插件以 `package.json` 声明清单；核实 `packages/neuro-book/src/plugins/*/plugin.ts` 全部是 TypeScript 常量定义的 `PluginDefinition` 对象（Spec 第 129 行自述"清单文件、声明 schema 与版本范围（含 `version-mismatch`）尚未实现"） |
| **`engines.neurobook` 版本范围、`version-mismatch`** | — | — | **未实现**：没有 semver 范围校验，验收场景 8（"版本范围"）无法运行 |
| **第三方插件 id 校验、`pluginVersions` 校验** | — | — | **未实现**：这些校验依赖清单文件存在 |

### 结论与建议

这份 Spec 想定的交付物是"内置与第三方插件使用同一份声明式清单"（`package.json`），但现实是内置插件全部用代码常量定义（`PluginDefinition`），且这套代码定义已经被 `runtime.plugins` Spec 实现、验收并晋升为 `implemented`。也就是说：

- 本 Spec 里"受阻推导、依赖图、启停顺序、按单条贡献校验、运行位置装配"这些**行为**，确实已经实现——但实现、测试和证据都已经记在 `runtime.plugins` 名下，`runtime.plugin-manifest` 对它们只是重复描述（第 129 行自己也这么说）；
- 本 Spec **独有**的内容——声明式清单文件格式本身（`package.json` 的字段结构）、semver 版本范围校验、`engines.neurobook`——完全没有实现，没有一行代码读 `package.json` 当清单。

**不建议晋升。** 这不是"差一点点"的缺口，而是本 Spec 的核心交付物（清单文件）整体未动工，已完成的部分是另一份 Spec 的范围。三个可选处理方式，供开发者选择：

1. 保持 `planned`，等清单文件真正落地（含安装器读取第三方清单、semver 校验）后再晋升；
2. 把本 Spec 改写为纯粹的"清单文件格式"差量 Spec（只写 `package.json` 的字段结构与校验规则，不复述受阻推导等已经属于 `runtime.plugins` 的行为），行为部分改为链接 `runtime.plugins`，这样可以让"清单文件尚未实现"这一条更聚焦，但依然保持 `planned` 直到清单文件实现；
3. 如果清单文件这个目标本身已经被放弃（例如改为永久使用代码定义的插件，不打算做文件化的第三方插件清单），应该在提案或 ADR 里正式撤回这个目标，而不是让 Spec 继续以 `planned` 的状态挂着一个没有排期的目标。

本报告倾向方案 1 或 3（由开发者判断清单文件化是否仍是近期目标），**不代为决定**；无论哪种，当前都不应该晋升为 `implemented`，因为 `implemented` 意味着"规定当前产品行为"，而当前产品根本没有清单文件这种行为。

### 实现合同、证据

不起草——本 Spec 不满足晋升条件。如果开发者选择方案 2（改写为差量 Spec），行为部分的"证据"应该直接指向 `runtime.plugins` 的既有证据（[`runtime.plugins`](plugins.md) 的"证据"一节），不重复链接。
