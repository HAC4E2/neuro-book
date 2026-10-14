---
schema: nbook.task/v2
taskId: t86-explorer-polish
status: active
updated: 2026-10-14
---

# 资源管理器打磨

## 目标与范围

打磨工作台左侧的资源管理器（文件树）前端组件：先截现状、对照旧应用，与开发者确认要改的点与注意力排序，静态稿评审定稿后实施。走 nbdev 流程（评审板、提问与答复、dev 与 shot），流程上的问题随时记下交 nbdev 优化。

合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)；要改哪些等第一轮评审定。组件文档 `packages/neuro-book/src/plugins/explorer/web/components/` 的 `ExplorerRow`、`ExplorerTree`、`FilesExplorerView`。

执行位置：`.worktree/w00017-t86-explorer-polish`，分支 `feat/w00017-t86-explorer-polish`（经 `nbdev worktree new` 从 `master` 创建）。评审板：[artifacts/review](artifacts/review/index.html)。实施计划：[plan.md](plan.md)（开发者 2026-10-14 确认）。

## 当前状态

- 2026-10-14 经 nbdev 新建。现状截图：开发服务（`nbdev dev start`）里的样例作品“雾港”（本地 `.local/agent/works/<本 Work>/tasks/t86-explorer-polish/sample/`，三层正文、一个内容文件夹、图片与长文件名），以及 `nbdev shot` 截的 Lab `FilesExplorerView` 场景；原图在本地 `shots/`。
- 第一轮评审板列出 11 条看到的问题（缩进参考线、中文数字排序、`.md` 扩展名、文件类型图标、只有正文的节点可展开、内容文件夹的样子、两个根、标题动作、右键菜单、过滤框、章节字数），逐条问改不改。
- 第二轮评审板：在真实工作台与 Lab 场景上注入候选样式截的静态稿（不改源码；脚本在会话临时目录）：catppuccin 彩色与单色、状态挂在文件夹行上、两个根 A 与 B、过滤框 A 与 B、参考线与缺省值、隐藏 `.md` 的缺省值、右键菜单；拖动实测 7 种拖法并对照旧应用 `WorkspaceFileTree` 的 HTML5 拖放，列出现在、旧应用与建议，逐条问。实测发现：拖到文件上、两行之间、空白处都没有落点，收起的文件夹不自动展开，边缘不滚动，指针旁没有拖影、落点标签压在下一行上。

- 第三轮评审板：catppuccin 的亮色（Latte、降饱和）与三种暗色（Frappé、Macchiato、Mocha）放进 nbook、macos 两个主题 × 明暗截图（设置写开发服务的 `.dev-state/settings.json` 实时切换）；短标记改成行尾的 lucide 状态图标；搜索与过滤的分工。更正第一轮的一句误述：新应用没有按文件名的快速打开（`workbench/quick-open.md` 把它列为非目标），也没有正文搜索。

- 2026-10-14 实施（分支 `feat/w00017-t86-explorer-polish`）：
  - S0 Spec 修订（`85cb3f2b2`）：files-explorer、folder-kinds、files、editor 四份。
  - S1 Files（`c1bc726b7`）：“第 N 卷 / 章”里的中文数字按数值排序（比较放到 `files/shared/names.ts`，Lab 内存适配器共用）、内容树目录的 `leaf`、只读方法 `realPath`，远程合同版本 4。files 测试 106 例与新增的排序单测通过。按计划用 `perf:files` 在本机对照展开内容文件夹（D2）：master 首次展开 p50 85 ms，本分支 65 ms，没有变慢（本机噪声范围内；原始结果在本地 `perf/`）。
  - S2 图标（`2004eca19`）：`gen:file-icons` 从 `@iconify-json/catppuccin` 生成 36 个图标，`FileIcon` 内联 SVG、亮 Latte 暗 Macchiato；Lab `FileIcon` 场景明暗截图核对。
  - S3 行的样子（`192b1a601`）：状态挂在目录行上、状态图标、后缀副标题、叶子不可展开、根的分节标题、缩进参考线，两个设置项归新分区“资源管理器”，`retry-list` 命令；explorer、lab、files、settings 的 Bun 366 例与 Vitest 209 例通过，`files-explorer`、`lab-explorer`、`settings` 三组 e2e 23 例通过；真实工作台（雾港）截图核对排序、图标、参考线与设置窗口。
  - S4 右键菜单（`40cf4e1c1`）：命令 `open`、`open-to-side`、`copy-path`、`copy-relative-path`，`nbook.editor.open` 加 `group`（组 id 或 `side`）；nb-ui 菜单的快捷键靠右、正文字体。菜单阴影只改了 nbook 主题的 `--elevation-menu`（加一层远投影）：它是 t79 第五轮特意收小的，macos 的菜单本来就用较深的浮层阴影，没动；计划原写改全局浮层阴影，收窄到菜单。
  - S5 拖动（`35ecd4d37`）：落点分行、树里的空白、编辑组三类；拖到文件上或两行之间移入所在文件夹、空白移入根、编辑组在那一组打开；移入画目标目录整段、拖影、源行淡化、`aria-live` 播报；停留 600 ms 展开；边缘滚动。
  - S6（`d25976f43`、`1223b4906`）：Lab 实时场景加叶子节点与几种文件类型；一个 opus 子代理做了一轮实现审查，14 条（应改 4、建议 10），处理见 [evidences/impl-review.md](evidences/impl-review.md)：12 条改了或改了 Spec，R5 不改（理由在记录里），R12 记录取舍。
  - 验证（`1223b4906`）：typecheck 0；neuro-book Bun 1102 例与 Vitest 209 例通过（Files 订阅的一例在全量负载下偶发失败一次，单独跑与再跑两次全量都通过，与本次改动无关）；新应用全套 e2e 200 例通过（审查修正之前跑的），修正后资源管理器 e2e 16 例通过；`test:affected --typecheck --since master` 只剩已知的 llmlint 两项与 neuro-book-test-support 一项；`docs:check`、`governance:check` 0 失败。收口截图（开发服务里的雾港，nbook、macos × 明暗，无页面错误）：[final-themes.webp](evidences/final-themes.webp)、右键菜单 [context-menu.webp](evidences/context-menu.webp)。
  - 未验证：触摸设备上的停留展开与边缘滚动只看了代码；跨机器访问时“复制路径”给的是服务端机器上的路径（Spec 写明）。

## 决定

第一轮（2026-10-14，评审板 v1 的答复 `20261014T034813624Z-cf13a7aa`）：

1. 缩进参考线：做成可选、可配置，照 VS Code（不显示、悬停时、一直显示）。
2. 普通文件夹按中文数字与阿拉伯数字的数值排序：改。
3. 隐藏 `.md` 扩展名：做成可选、可配置；缺省怎样待定（VS Code 没有内置这一项，要自己定缺省与改名时的显示）。
4. 文件类型图标：改；现有图标不够用，要引入成套的图标素材，开发者举了 [catppuccin/vscode-icons](https://github.com/catppuccin/vscode-icons)。
5. 只有正文的节点不可展开：改；并且不要“空目录”“清单不合法”这种占一行的状态展示，换别的形式。
6. 内容文件夹的样子（名字去后缀、图标同文件夹家族）：改。
7. 两个根的样子：改；A（分节标题）还是 B（两个可折叠分节）下一轮出稿再定。
8. 标题动作：不改。
9. 右键菜单（快捷键右对齐、阴影、补打开与复制路径）：改。
10. 过滤框：这次做。
11. 章节字数：先不改；要做得系统性地做，不加特例。

开发者另提：资源管理器的拖动问题很多，要参考旧应用的拖动行为重做。

第二轮（2026-10-14，评审板 v2 的答复 `20261014T041650657Z-f8466697`）：

1. 图标用 catppuccin 彩色；配色要多做几种（含暗色）出来再看效果。
2. 状态挂在文件夹行上（名字着色、行尾标记、悬停看原因，读取中换转圈，空文件夹不显示）；“需要剧情插件”这类短标记也做成状态图标，悬停看到文字。
3. 两个根取 A（分节标题，仍是一棵树）。开发者指出这很像 JetBrains IDE 的项目视图，那里还有 Scratch 文件夹与第三方库文件夹这类根。
4. 过滤框取 A（固定在树上方），但要再设计一轮：搜索是很常用的功能，不能像普通 IDE 那样简单；也可以像 VS Code 一样另有专门的搜索视图。
5. 缩进参考线缺省“悬停时显示”；隐藏 `.md` 缺省关闭（显示扩展名）。
6. 右键菜单照候选改。
7. 拖动：拖到文件上或两行之间移入那个文件所在的文件夹并高亮整个目标文件夹、拖到空白移到项目根、停在收起的文件夹上自动展开、边缘自动滚动、指针旁的拖影与源行淡化（落点标签跟着指针）、拖到编辑区打开，都改。
8. 从系统拖文件进来另开 Task：[t87](../t87-explorer-os-import/README.md)。

第三轮（2026-10-14，开发者在会话里答复，代录为 `20261014T042845838Z-2b481309`；面板的多选题无法作答，开发者已记为面板的 bug）：全部同意推荐。

1. 亮色用 Latte 原色，暗色用 Macchiato（catppuccin 按名字一一对应换色）；不做配色设置项。
2. 短标记（无正文、缺失、未列入、需要剧情插件、剪切中）改成行尾弱化色的状态图标，悬停显示文字。
3. 搜索先不做，包括过滤框：搜索适合单独开一个搜索服务插件（[t88](../t88-search-plugin/README.md)）；过滤框、快速打开与搜索视图都建在它上面。过滤框匹配文件名、展示名、拼音全拼与首字母、覆盖整个作品，这些记进 t88。第二轮第 4 条（过滤框固定在树上方）随之移到 t88。

## 下一步

等开发者验收（开发服务 `nbdev dev start` 起在 4217，样例作品“雾港”在本地 `.local/…/t86-explorer-polish/sample/`）。合入 master 要开发者授权。
