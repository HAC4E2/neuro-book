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
- 评审板：本机 `.local/design-review/t80-settings-ui/index.html`（git 忽略），各轮截图在同目录 `r1/`、`r2/`…；开发者 2026-10-12 决定讨论过程的图片不入库。

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
- S2（设置窗口、`SettingsRow`、`SettingsPageList`、打开命令、外观分区、Lab 场景）已派编码子代理实施。主 Agent 替计划定下：两个行组件放 `src/ui/settings/`（架构规则只允许插件之间引用 `shared/contracts`）；层快照加文件路径字段，供层无效时显示。
- 搭稿时发现的 nb-ui 缺陷记为 [t81](../t81-nb-ui-text-size-segmented/README.md)。另有：缺扁平的分区导航组件（设置窗口先在应用里自己做）；带候选的输入框与其它控件外观不统一、`FormNumberInput` 没有单位后缀的位置（编辑器分区接入时处理）。

## 下一步

S2 交回后主 Agent 审查、验证、提交，再派 S3（示例插件）；S4 等 t78 与 t79 S2 提交后对齐再做。
