# Route B 设置与配置真相源第一纵切实施计划

> 本计划落实已冻结的 Route B 插图设计中“设置与配置真相源”交叉切面。工作在用户指定的现有工作目录内进行，不创建 worktree，不改变前序设计文档的暂存状态。

## 目标

建立 `illustration.director` Agent Runtime provider/model binding 的唯一持久化真相源，并完成可独立验证的 UI/API 闭环：

- 唯一写入位置：Workspace Root Global Config 的 `agent.profiles["illustration.director"].model.modelKey`。
- 唯一编辑入口：全局“设置 → 模型配置”。
- 文生图分页：只读展示同一 binding 的配置状态、Provider、模型和检测入口跳转。
- Project Config：禁止覆盖 Director model binding；未来仍可写 Director 的 project-scoped `settings`。
- NovelAI 参数：不进入 Config/Agent/Profile/Skill/Storyboard DTO；本轮不新建任何 NovelAI 写面。

## 非目标与硬边界

- 不实现 TTP（text-to-picture）`tagData` 的任何下载、导入、转换或占位。
- 不把现有正文生图 LLM provider 记录转换成 Agent Runtime binding；这种桥接会形成兼容层和双真相。
- 不在本轮实现完整 Director planning operation、Storyboard、Tag Pattern、Recipe、Prompt Compiler 或队列 lane 重构。
- 不在本轮完成 NovelAI Provider 的数据库单例迁移或 Recipe 服务端真相源；这些属于后续 P1 纵切，walkthrough 必须保留差距。
- 不自动运行浏览器验证，不提交、不推送、不发布。

## Task 1：用失败测试冻结 binding 合同

**文件：**

- 新增：`shared/dto/config.dto.test.ts`
- 修改：`server/config/config-service.test.ts`
- 修改：`server/config/normalizer.test.ts`
- 修改：`server/config/settings-security-contract.test.ts`

**步骤：**

1. 添加 DTO 测试，要求 Director summary 只含 binding/model/provider 只读字段，并使用 strict schema 拒绝 NovelAI 参数。
2. 添加 Project DTO 测试，要求 `illustration.director.model` 被拒绝，但同 key 的 `settings` 仍可通过。
3. 添加 Config Service 测试，要求 Global 保存后 editor snapshot 返回已解析的 Director Provider/model 摘要。
4. 添加 Config Service 测试，要求 Project 保存 Director model 返回明确 400 错误。
5. 添加 normalizer 测试，要求手工存在于 Project 文件中的 Director model 不能覆盖 Global binding，但 project settings 仍参与合并。
6. 添加 UI ownership 源码合同：文生图摘要从 Config 读取，不出现 Director provider/model 写表单；模型设置页包含唯一 binding 编辑卡。
7. 运行聚焦测试，确认新增断言先失败并记录 RED 证据。

## Task 2：实现共享类型、解析和服务端硬边界

**文件：**

- 新增：`shared/agent/illustration-director.ts`
- 修改：`shared/dto/config.dto.ts`
- 修改：`server/config/normalizer.ts`
- 修改：`server/config/config-service.ts`

**步骤：**

1. 定义共享的 `ILLUSTRATION_DIRECTOR_PROFILE_KEY`、binding ID 与未配置错误码常量。
2. 定义 strict `IllustrationDirectorModelBindingDtoSchema`，字段仅限：binding ID、configured、modelKey、Provider ID/名称、model ID/名称。
3. 把 binding summary 加入 `ConfigModelSettingsDto`，不暴露 secret，也不新增 PUT endpoint。
4. 在 Config Service 中从 normalized effective config 解析 binding；模型缺失、被禁用或引用失效时返回 `configured=false`。
5. 扩展 Project global-only guard，明确拒绝 `agent.profiles["illustration.director"].model`。
6. 在 Project normalizer/effective merge 中剥离 Director model patch，同时保留 settings/runtime，为手工文件和未来配置入口提供第二道边界。
7. 运行 DTO、normalizer、Config Service 聚焦测试，确认 GREEN。

## Task 3：全局模型设置建立唯一编辑与检测入口

**文件：**

- 修改：`app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- 修改：`app/i18n/locales/zh-CN.ts`
- 修改：`app/i18n/locales/en-US.ts`

**步骤：**

1. 在 Global Models 草稿中加入 `illustrationDirectorModelKey`，从 editor snapshot 的 binding summary 初始化。
2. 把该字段加入 dirty snapshot，保证只修改 Director binding 时保存按钮可用。
3. 构造 Global Config payload 时只写 `agent.profiles["illustration.director"].model.modelKey`，保留该 profile 的其他 settings/runtime。
4. Provider/model 被禁用、重命名或删除时，使用现有模型引用清理逻辑把 binding 置为未配置。
5. 增加全局专属 Director binding 卡：模型选择、配置状态、Provider 连接定位入口、绑定模型检测/取消入口。
6. 模型检测直接复用现有 `runModelCheck(provider, model)`，检测结果保持临时 UI 状态，不持久化第二份健康真相。
7. 使用现有主题变量和中英双语 i18n，不新增 Tailwind 调色板颜色。

## Task 4：文生图只读摘要与受控跳转

**文件：**

- 新增：`app/utils/settings-navigation.ts`
- 修改：`app/components/novel-ide/NovelIdeSettingsDialog.vue`
- 修改：`app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- 修改：`app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- 修改：`app/pages/index.vue`

**步骤：**

1. 定义严格的 settings navigation request，只允许跳到 Global/Models/Director focus。
2. Settings Dialog 监听单调递增 request ID，强制选择 Global/Models，并把 focus 交给模型面板。
3. 模型面板在 focus 到来时滚动到 Director 卡；不改变保存语义。
4. 文生图面板使用 `useConfigApi.editorSnapshot(globalQuery())` 读取 binding summary；只保存 loading/error 草稿，不把 binding 放进 Pinia persisted state。
5. 监听 Config revision，在全局设置保存后刷新摘要。
6. 用只读 Director 卡替换当前正文 `bodyImage` provider 摘要入口，显示 configured/provider/model 和“在模型配置中设置/检测”按钮。
7. 通过页面宿主打开 Settings Dialog，不给文生图组件任何 Global Config 写函数。

## Task 5：验证、审查和文档同步

**文件：**

- 修改：`docs/tasks/text-to-image-panel/README.md`
- 修改：`PROJECT-STATUS.md`（仅在实现确实改变架构状态后）
- 修改：`.planning/2026-07-18-route-b-settings-truth-source/*`

**步骤：**

1. 运行 DTO/normalizer/config service/security contract 聚焦测试。
2. 运行相关 text-to-image store/LLM 测试，确认只读摘要未影响现有辅助角色设计链。
3. 运行 `bun run typecheck`；若命中已知 Plot 基线失败，记录本轮文件是否出现新增错误。
4. 请求代码审查，处理 P0/P1 以及与冻结设计直接冲突的问题。
5. 更新 active walkthrough：实际变更、RED/GREEN 证据、文件、验证、与计划偏差、后续纵切。
6. 若架构状态已改变，更新 `PROJECT-STATUS.md`，明确只完成“设置层第一纵切”，不宣称 Route B/P1/P2 完成。
7. 检查没有执行 commit/push/release；不在任务末尾主动运行 git 状态命令。

## 预计测试影响

- `ConfigModelSettingsDto` 新增必填默认字段，直接构造 snapshot fixture 的测试可能需要补 `illustrationDirector`。
- Project Config 以前可写任意 profile model；新增 global-only 约束会使相关泛化测试需要改为非 Director key。
- 模型设置 dirty snapshot 从纯 models 扩展为 models + Director binding，Provider 删除/重命名测试需覆盖 binding 清理。
- 文生图页面不再把 `bodyImage` Provider 摘要作为 Director 设置入口；旧正文 LLM runtime 仍是后续迁移项，不能用本轮测试冒充 Route B planning 已接通。

