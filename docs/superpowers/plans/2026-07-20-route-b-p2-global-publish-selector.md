# Route B P2 Global Companion Publish / Selector 实施计划

## 目标

把已完成 Tag resolution 的 `pending` Storyboard + Tag Pattern companion 作为一个不可变全局版本包发布，并最后以 Global Config `agent.profiles["illustration.director"].settings.storyboardPresetKey` 切换 selector。任一中断阶段都不得让半套新工件生效；旧 selector 必须继续解析上一份完整 approved pair。

## 冻结边界

- 发布入口只接受当前已登录且拥有 Global Config 写权限的用户；Agent、Skill 与 import conversion 工具不获得发布或任意全局文件写权限。
- 请求必须携带 `importId`、resolved preview token、原 candidate/diagnostic hash、三项 expected hash、`targetScope: global` 与 `confirmGlobal: true`。actor 身份由服务端生成。
- 批准准备阶段重新读取并复验原 `upload/*.json`、raw source hash、脱敏 archive、resolved Storyboard/Pattern/diff 与 import journal。prepared journal 完成后，恢复不再依赖原 upload 存续。
- 新 pair 使用 `resourceKey` 写入 `storyboard-presets/<resourceKey>.md` 与 `tag-patterns/<resourceKey>.md`，两份文件都为 approved strict Markdown 且 create-only；不原地覆盖 selector 指向的旧版本。
- `presetId` 与 active 逻辑身份冲突时，用户必须显式选择“替换当前 preset”或“另存为新 presetId”。另存为会确定性重绑定 pair identity 与 Pattern resolution keys，并生成新的 preview token/hash；不能只改文件名。
- Global Config 是 selector 的唯一真相源。发布服务使用统一序列化的 expected-hash CAS 更新 Director selector；浏览器/localStorage、Profile Home selector 文件或兼容 fallback 均禁止。
- 独立 publish journal 状态为 `prepared -> preset_published -> patterns_published -> selector_updated -> completed`；selector CAS 失败显式记为 `published_not_selected`，重试只复验既有 immutable files 并更新 selector。
- 本纵切不实现 Project overlay、角色/服装 V2、P3 planning/retrieval，也不自动运行浏览器验证。

## Task 1：严格发布合同与 companion rebase

**文件**

- 新增 `shared/text-to-image-storyboard-publish.ts`
- 新增对应 contract test
- 扩展 `server/text-to-image/storyboard-candidate.service.ts` 与测试

**RED / GREEN**

- strict target union：candidate ID 显式替换确认，或合法且不同的 save-as presetId；拒绝 prompt、Provider、Recipe、NovelAI 标量和任意目标路径。
- preview/request/result/journal schema 绑定 source candidate hash、published candidate hash、diagnostic hash、目标 pair path、active pair hash、Global Config hash、actor 与阶段。
- save-as 确定性重绑定 `presetId/patternSetId/packageId/resourceKey`、resolution key、分组 refs 与 policy approval owner；terminal resolution 内容不漂移。
- 重新计算 Storyboard semantic、Pattern planning/render、candidatePackageHash 与 preview token；旧 resolved token 不能直接批准 rebased pair。

## Task 2：Global Config selector snapshot / CAS

**文件**

- 扩展 `server/config/config-service.ts`
- 扩展 `server/config/config-service.test.ts`

**RED / GREEN**

- 新增有限 selector snapshot：只暴露 `storyboardPresetKey + configHash`，不暴露 Provider secret。
- 新增 expected-hash CAS，只能修改 Director `settings.storyboardPresetKey`，保留 model/runtime/其他 settings 与整个 Global Config。
- 所有 Global Config 写入口进入同一进程内串行临界区，避免普通设置保存和 publish CAS 同时 read-modify-write 丢更新；hash 漂移稳定拒绝。
- 配置缺失时 selector 默认指向 `storyboard-presets/default.md`，但不制造第二份 selector 文件。

## Task 3：独立 publish journal 与可恢复服务

**文件**

- 新增 `server/text-to-image/storyboard-publish-journal.ts`
- 新增 `server/text-to-image/storyboard-publish.service.ts`
- 新增对应测试
- 扩展 `server/text-to-image/storyboard-import.service.ts` 的发布只读复验边界

**RED / GREEN**

- preview 无写入：读取 active selector/pair，计算 expected active file hashes 与 config hash；冲突未确认时返回不可发布 gate。
- prepare 复验 Project open/source bytes/archive/resolved artifacts/hash/token，冻结 approved pair bytes、目标路径、previous selector 与 expected hashes后才写 journal。
- 每个阶段先复验当前事实，再 create-only/幂等推进；已存在同路径但 bytes 不同则 conflict。
- preset 已写、Pattern 未写；两份已写、selector 未切；selector 已切、completed 未记账等中断均可重放。
- selector CAS 冲突进入 `published_not_selected`，旧 selector 不变；使用新 expected config hash显式重试只切 selector，不重新转换或覆盖文件。
- completed 重放返回同一 receipt；previous selector/pair 始终保持可解析。

## Task 4：鉴权 API 与 import 审批 UI

**文件**

- 新增 `server/api/text-to-image/storyboard-imports/publish-preview.post.ts`
- 新增 `server/api/text-to-image/storyboard-imports/publish.post.ts`
- 扩展 Storyboard import HTTP error mapping
- 扩展 `TextToImageStoryboardImportPanel.vue`

**RED / GREEN**

- API strict body、ProjectSession、当前用户和 Global Config 写权限；客户端不能指定 actor、全局路径或已批准 Markdown。
- UI 显示 active pair、目标 pair、三项 expected hash、全局影响与冲突选择；必须勾选 `confirmGlobal` 才发布。
- publish 进度/`published_not_selected`/completed 明确显示；成功后刷新 config revision/preview，但不保存第二份 selector。

## Task 5：验证、审查与记账

- 运行 contract/rebase/config CAS/publish journal/import 组合 Vitest 与 `bun run typecheck`。
- 静态审计 Agent/Profile/Skill 无 publish/Config/Provider/Recipe/NovelAI 参数写权限，前端无 selector/localStorage 双真相。
- 更新同一 walkthrough、`.planning` 进度与 `PROJECT-STATUS.md`，记录阶段中断测试、计划偏差和仍待 Project overlay/角色迁移/P3 边界。
- 本阶段无 Prisma schema 变化，不运行无意义的 Prisma generate；不自动做浏览器验证，不提交、推送或发布。

## 实施结果（2026-07-20）

- Task 1–4 已完成：strict preview/request/receipt/selector-retry 合同、save-as companion 全量 rebase、Global Config selector expected-hash CAS、独立 publish journal、可恢复服务、admin-only API 与导入面板均已落地。
- 发布请求以 `publishPreviewToken` 派生稳定 publishId；approved Storyboard/Pattern 先冻结为 publish archive，再 create-only 写目标 pair，selector 始终最后更新。相同路径不同 bytes 分别返回 `STORYBOARD_PRESET_STALE` / `TAG_PATTERN_SET_STALE`。
- `published_not_selected` 会保存服务端重新读取的 config hash；显式 retry 只复验 immutable target pair、previous active hashes 和 selector，再执行 CAS，不重新读取 upload、不重复转换、不覆盖工件。
- 自审新增并发 RED：两个相同 publish 请求曾并发截断 `journal.json`。实现按 normalized global root + importId + publishId 的共享进程内锁后，两个请求都返回同一 completed receipt，来源只复验一次、selector 只更新一次。
- API 固定使用 Project-open、当前用户与管理员三重守卫；客户端不能提交 actor、目标路径或 approved Markdown。UI 只保存组件生命周期内的选择/确认，不使用 localStorage，也没有 Provider/Recipe/NovelAI 参数写入口。
- 组合回归覆盖 strict contracts、rebase、import 来源复验、journal 恢复/并发、Config CAS、HTTP error、API/UI 静态权限边界；完整 `bun run typecheck` exit 0。无 Prisma schema 变化，未运行 generate；未做浏览器验证、提交、推送或发布。
