# Route B P2 Character Visual Sources / Proposal-only 实施计划

## 目标

闭合 Character/Outfit V2 的剩余 P2 来源：公开明文 TTP（text-to-picture）角色/服装 export、经既有 `novel-import-silly-tavern-card` 落入 Project 的标准 SillyTavern card/PNG 角色事实，以及角色详情页的 Director-bound 生成结果。所有来源只能形成同一种 Project migration proposal；未经 Resolver、逐字段决策和用户逐项确认，不能写入 V2 或被新 Director/Compiler 消费。

## 冻结边界

- TTP 只支持公开源码可证明的明文根 `{characters, outfits}`。角色只读取 `nameCN/nameEN/characterTraits/facialFeatures/facialFeaturesBack/upperBodySFW/upperBodySFWBack/fullBodySFW/fullBodySFWBack/upperBodyNSFW/upperBodyNSFWBack/fullBodyNSFW/fullBodyNSFWBack/outfits`；服装只读取 `nameCN/nameEN/owner/upperBody/upperBodyBack/fullBody/fullBodyBack`。
- `_encrypted` export 明确 report-only，不实现 decrypt；`images`、photo、generation context/variables 等非视觉 Tag 字段不进入 proposal；未知 top-level/record 字段不猜语义。任何 `tagData` 都拒绝且不建立 adapter。
- Storyboard Context `entries` 中只有文字命中“角色/服装”但没有上述确定结构时继续 report-only；不把自然语言、宏或私有对象猜成角色 schema。
- 标准 SillyTavern card/PNG 继续走现有 `novel-import-silly-tavern-card`。本模块不解析 PNG chunk、card spec、worldbook、script 或动态变量，只从通用 importer 已落盘的 Project 角色事实创建 proposal。
- 外部来源不能直接决定 Project path。目标角色必须由当前 Project 中唯一稳定 identity 匹配，或由用户显式选择；已有字段默认保留，逐字段覆盖必须有显式决策。共享 outfit、缺失 ref、owner 冲突或多目标 identity 都 blocking。
- proposal 的 atom 全部进入当前 generic NovelAI Resolver；Provider syntax 只允许版本化 registry 中的 typed node。apply 复用现有 Project-open、current user、tracked write、source/target CAS 与可恢复 journal。
- 不新增 Provider/Recipe/NovelAI 参数写面，不使用 localStorage，不自动做浏览器验证，不提交、推送或发布。

## Task 1：通用 strict JSON 边界与公开 TTP visual source parser

- 从现有 TTP Storyboard parser 提取可复用的 strict JSON document parse；继续保持 duplicate/prototype/depth/size/UTF-8/secret redaction 上限，Storyboard shape 校验仍只属于 Storyboard parser。
- 新增 versioned shared source package、source character/outfit、diagnostic 与 stable hash 合同。
- 用公开字段 allowlist 生成 canonical visual package；图片和已知非执行字段只记忽略诊断，未知/加密/冲突记录不能产生 proposal。
- 测试固定 object key 顺序无关、images 不污染 visual hash、encrypted/unknown/tagData fail-closed、outfit ownership/ref 完整性和 stable identity。

## Task 2：外部 source list / inspect 与统一 migration proposal

- 在 Project `upload/*.json` 上新增 visual source inspect，不复用 Storyboard conversion endpoint，也不让客户端提交 source bytes/path outside upload。
- 扩展 migration candidate provenance 与 target base：外部 source hash、目标 Project 文件 hash/null、字段级 `keep_existing | use_proposal` 决策和 blocking diagnostics 都进入 preview token。
- 自动 identity 只接受唯一 exact stable ID/name；否则 UI 显式选目标。缺失 `image-tags.md`/outfit target 使用 create-only null base；已有文件复验并默认 keep。
- source proposal 与现有-file proposal 最终都进入同一 Resolver/resolution/apply journal，不建立第二个 apply service。

## Task 3：标准 SillyTavern card/PNG handoff

- 读取既有 importer 的稳定 Project 输出合同，只消费 character identity/description 中明确的结构化视觉字段；通用 prose 只形成 Director proposal source，不直接拆 Tag。
- 不复制或 import skill 内部 PNG/card parser；未完成通用 importer 的卡只显示引导，不在 Route B 猜路径。
- 与 TTP source 使用同一 identity/field decision/resolution/journal 合同。

## Task 4：角色详情 generation proposal-only

- 删除角色详情页任意 LLM provider/model + 直接覆盖旧 free-string Markdown 的写入口。
- 生成入口只引用 Global `illustration.director` binding，通过 canonical Agent session/invocation 产出严格 source proposal；无 binding、模型失败、输出 schema 错误和 Project stale 使用可见错误出口。
- Profile/Skill 不获得 V2 apply、Provider、Recipe 或 NovelAI 参数权限；用户仍必须在 migration UI 逐字段/逐 atom 审核并 apply。

## Task 5：验证与记账

- 聚焦运行 source parser、migration service/API/UI、Director proposal 及 V2-only registry 测试；随后完整 typecheck。
- 无 Prisma schema 变化则不运行 generate；若后续实际引入 schema，再运行已授权 Prisma generate。
- 更新 active walkthrough、持续计划和 `PROJECT-STATUS.md`，记录真实支持范围、report-only 计数、计划偏差与剩余 P3/P4 边界。

## 实施结果（2026-07-20）

- Task 1–2 已完成：公开明文 source parser、source scan/inspect、目标选择、字段冲突、target base set hash、统一 migration provenance 与 apply source CAS 均已落地。
- Task 3 已完成且与原计划一致：没有复制标准 SillyTavern JSON/PNG/card/worldbook parser；只消费既有 importer 落到 Project 的标准角色 `index.md` 事实。自由 prose 作为 Director 数据，不直接拆 Tag。
- Task 4 已完成并采用更严格的 operation 工具注入：角色详情不再保存独立 LLM provider/model 或 task prompt，不再调用旧 extractor/completion，也不直接写视觉文件；`illustration.director` 的角色 operation 只获得 `report_result`。
- 原计划中的“角色详情生成结果直接形成统一 proposal”具体化为两段式：Agent strict report 先写 proposal record/preview，用户确认字段冲突后才创建 migration candidate；Tag Resolver/逐项接受/apply journal 完全复用既有服务。
- 聚焦验证 `8 files / 37 tests passed`，完整 typecheck 通过；无 Prisma、浏览器或 git 操作。
