---
schema: nbook.task/v2
taskId: t80-settings-ui
---

# 设置界面：`nbook.settings` 的界面与贡献点

## 目标与范围

开发者 2026-10-12 决定先做纯前端的旧功能迁移，第一个是设置界面：主 Agent 负责调度和讨论，子代理实施。新应用的 `nbook.settings` 已有配置合同（[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)：声明、三层合成、读写、外部修改），但“设置界面、用户编辑的写入路径与密钥”只定了合同（planned）。本 Task 做设置窗口、它的贡献点与两处入口，范围与切片见 [plan.md](plan.md)。

参照：旧应用的设置界面（w00003 t17、t18 重做，`a3c6550f` 接进产品），清单见 [legacy-settings-inventory.md](legacy-settings-inventory.md)。

## 执行位置

- 代码：worktree `.worktree/w00017-t80-settings-ui`，分支 `t80/settings-ui`，从 `refactor/w00017-runtime-foundation` 的 `fb6e94a2` 分出；`.worktree/w00017-runtime-foundation` 有别的会话在做 t78，本 Task 不碰它。合回前按 t78、t79 的提交重新对齐。
- 设计草稿：worktree `.worktree/w00017-t80-drafts`（分支 `t80/drafts`，不合并），Lab 里的一次性草稿场景在 `packages/neuro-book/src/plugins/lab/web/fixtures/drafts/`，不提交。
- 评审板：本机 `.local/agent/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/review/index.html`（git 忽略），各轮截图在同目录 `r1/`、`r2/`…；实现阶段的截图在同一 Task 的 `shots/`；开发者 2026-10-12 决定讨论过程的图片不入库。

## 设计决定

开发者在评审中确认（编号沿用讨论时的顺序）：

1. 设置是浮动窗口加左侧分区，一次只显示一个分区。
2. 每项标题在左、控件在右（具体排法见第 11 条）。
3. 入口和头像放在一起：工作台活动栏最下面头像在上、齿轮在下；书架右上角齿轮在头像左边（P1，不做头像菜单）。头像在账户插件迁回前是不可点的占位。
4. 层级：界面顶部切换“用户 | 本作品”，每个分区有明确的目标层，自定义整页接收这个参数；旧的“启动”档不进设置界面（在设置插件之前读的配置归宿主）；“本机”层只在合同里留位置，桌面端回来时实现；编辑器偏好放用户层。
5. 贡献点：`settings.properties` 补所属分区与小组、顺序、选项显示名、生效时机（取代 `restart` 布尔）；新增 `settings.sections`，分通用列表与插件自己提供组件的整页；不设单项自定义控件；工作台新增活动栏底部条目与页面浮层两个贡献点；实现用户编辑的写入路径（configuration 输出 19）。“已修改”指这一层写了这个键，“恢复默认”是从这一层删掉这个键。
6. 自定义整页本 Task 就实现，用 `packages/neuro-book/examples/` 的示例插件当使用者、在 Lab 里验收。
7. 编辑器分区排在 t79 之后接（t79 S3 在改正文的字号、行距与版心）。
8. 计划（含子代理标注时报的 12 处模型歧义的处理）开发者同意。
9. 窗口固定宽：缺省 960×640，切换分区时不变大小（不做按页面变宽）。
10. 设计讨论的草稿与截图放 `.local/`，一个 Task 一页 HTML 评审板；图片按原质量保存，能用 HTML 直接表达的设计不必截图。

11. 每项用混合排法：开关、分段、下拉、数字、单行输入用标签列加控件列；多行文本、JSON、列表这类宽控件另起一行、占满内容列。长文本的声明提示与宽控件的通用编辑随第一个使用者（Agent、向量嵌入迁回时）再加。
12. 开发者同意新增开发 Agent Skill `design-review` 并在 Work 规则里写明设计稿不入库（主线 `73b0853c`）。

## 当前状态

- 2026-10-12 设计四轮完成。S1（声明字段、`settings.sections`、用户编辑写入、两份 Spec）已提交 `177682b4`：主 Agent 复跑设置、共用声明、架构、清单与示例测试 115 通过、1 失败，三份 typecheck、`docs:check`、`governance:check` 通过；那 1 条失败（`commands.test.ts`“切换主题与明暗”，测试场地缺工作台在 t74 加的必需依赖 `windowNavigationKey`）在基线 `fb6e94a2` 上同样失败，交给 S2 顺手修测试场地。
- S2 已提交 `dbe41959`：设置窗口、`src/ui/settings/` 的 `SettingsRow`（含宽排法）与 `SettingsPageList`、`nbook.settings` 的窗口入口、命令 `nbook.settings.open`（`Ctrl+,`；工作台键位解析原本不认逗号，补了一处）与公开状态 `windowOpen`、外观分区、Lab 局部宿主与全部状态的场景。主 Agent 复跑：bun 1035 通过、Vitest 181 通过、三份 typecheck 与 `lab-scenes` 门禁通过；S1 时那条旧失败已随测试场地补齐恢复。截图在本地 `shots/s2/`。
  - 主 Agent 定下：层快照只给项目层带文件路径，用户层不带（[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 的路径可见性不发状态根给浏览器）；分区落位改为第一次打开时才算。
  - 对齐主线时要改：窗口里的书名现在取窗口项目绑定的登记名，t79 S1 已让绑定带上书名，对齐后改用它。
- S3 已提交 `2eef0fa2`：示例插件 `example.snippets`（片段数组配置项、column 页面、按层读写、教学注释）、场景 06，页面组件由 Vitest 测试覆盖（Vitest 改为也收集 `examples/**/*.dom.test.ts`）；`SettingsRow` 的宽排法在沿用时也画出停用的控件。架构规则不允许 Lab 引用 `examples/`，Lab 保留自带的最小页面。主 Agent 复跑 bun 测试四次：一次出现 1 个未捕获错误（输出没留下，来源未查明），另三次 1039 通过、0 失败；Vitest 183 通过，typecheck 与 `docs:check` 通过。
- 2026-10-12 主线 t78 S1–S2、t79 S1–S2 提交后，t80 分支合入主线对齐（`850f0871`，无冲突；合并后 typecheck 通过、bun 1044 通过、Vitest 183 通过）。
- S4 已提交 `28d4e3de`：`workbench.activitybar-items`（活动栏底部条目，`toggled` 按下态、没有命令的条目画成圆形占位）、`workbench.overlays`（页面根上的浮层，首页与工作台都挂）；设置齿轮与头像占位；设置窗口经浮层挂载、改用书名；书架右上角齿轮代替设置菜单（“作品目录…”移到设置）；作品插件贡献“作品”分区；外壳、书架、设置窗口 Spec 与 e2e。主 Agent 复跑：typecheck 通过，bun 1052 通过，Vitest 195 通过，e2e（设置、书架、Lab 门禁、外壳）28 通过。截图在本地 `shots/s4/`。
- S5 进行中：omp 实现审查（单独的审查 checkout `.worktree/w00017-t80-review`，固定在 `28d4e3de`）。
- 作品分区未设置时的文案“还没设，第一次新建作品时会记下”与书架行为不一致（书架只在用户改过新建位置时才写设置）。开发者定：改文案，没设时显示缺省目录（经 `library()` 取有效目录，标“缺省”），书架行为不变；随 S5 的审查修正一起改。
- 搭稿时发现的 nb-ui 缺陷记为 [t81](../t81-nb-ui-text-size-segmented/README.md)。另有：缺扁平的分区导航组件（设置窗口先在应用里自己做）；带候选的输入框与其它控件外观不统一、`FormNumberInput` 没有单位后缀的位置（编辑器分区接入时处理）。

## 下一步

S2 交回后主 Agent 审查、验证、提交，再派 S3（示例插件）；S4 等 t78 与 t79 S2 提交后对齐再做。
