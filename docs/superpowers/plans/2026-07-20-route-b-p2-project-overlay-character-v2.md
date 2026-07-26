# Route B P2 Project Overlay / Character V2 Migration 实施计划

## 目标

完成 P2 剩余两条 Project 真相源纵切：让当前 Global Storyboard/Pattern companion 可由 Project-local、按稳定 ID 的 approved overlay 增量覆盖；把现有自由字符串 `image-tags.md` / `outfits/*.md` 与受支持角色导入统一迁移为 generic NovelAI scope 的 typed resolution snapshots。二者都必须在新 Compiler 前 fail-closed，不能保留自由 Tag 运行兼容分支。

## 冻结边界

- overlay 只写 Project Workspace `agents/illustration.director/storyboard-overrides/<presetId>.md` 与 `tag-pattern-overrides/<presetId>.md`；Global base/selector 只读，通用 Config 合并器不参与 ruleId/patternId 合并。
- 保存草稿与保存并应用均使用 expected file hash；应用时还必须绑定当前 base semantic/planning/render hashes。任一 operation 冲突整份拒绝，不做部分 apply 或 last-write-wins。
- Project 写入统一经过 Project-open guard、当前用户与 tracked write；overlay 编辑器不能写 Provider、Recipe、图片参数或 Global Config。
- 角色/服装 V2 的运行字段只含同文件 resolution key；每个 key 必须有完整 `SemanticTagResolution`，resolutionScope 固定 generic NovelAI。自由字符串只允许作为 migration proposal source。
- 先扫描已有 `image-tags.md` / `outfits/*.md`，再接标准 SillyTavern card/PNG 与 Context 中已确定性识别的结构化角色字段；未知私有格式 report-only，不让 Agent 猜 schema/path。
- 无 active Tag index 时只生成 `pending_unresolved` proposal；index ready 后逐原子解析并展示 diff。apply 绑定 proposal hash、target base hashes、逐项确认与 idempotency key；先全量 render/validate，再 journaled tracked write。
- 迁移成功前，旧角色文件不作为 Route B Director/Compiler 的可执行视觉事实；迁移完成后删除旧自由字符串运行解析与正文 LLM/placer 消费路径，不建立 legacy adapter。
- 不自动运行浏览器验证；无 Prisma schema 变化时不运行 generate；不提交、推送或发布。

## Task 1：Overlay Markdown codec 与编辑 DTO

**文件**

- 新增 `server/text-to-image/storyboard-overlay.codec.ts`
- 新增 `server/text-to-image/tag-pattern-overlay.codec.ts`
- 新增 `shared/text-to-image-project-overlays.ts`
- 新增对应测试

**RED / GREEN**

- 两类 strict frontmatter canonical round-trip；body 不参与 semantic/planning/render hash，只参与 file hash。
- DTO 返回 current base pair identity/hash、两份 overlay draft/status/file hash、effective hash/count/provenance/diagnostics。
- save request strict 拒绝目标路径、Global Config、Provider、Recipe、NovelAI 标量与自由 Prompt；只接受 projectPath、presetId、markdown、expectedFileHash、mode。

## Task 2：Project overlay registry / CAS / effective resolver

**文件**

- 新增 `server/text-to-image/project-overlay.service.ts`
- 复用 Global selector snapshot、Profile Home、两类 P0 resolver 与 tracked workspace writer
- 新增服务测试

**RED / GREEN**

- 读取 selector 指向的 approved complete companion pair；half pair、pending/stale、identity mismatch 均 fail-closed。
- 缺 overlay 时返回绑定当前 base hashes 的 canonical pending 空 draft；不得静默写盘。
- draft save 只规范化 strict Markdown，不批准；apply 在内存重建 approved review hash，严格运行 resolver，冲突/stale 时不写盘。
- expected file hash 与当前 file hash 做 CAS；同 Project/preset 写入进入共享临界区，防止并发覆盖。
- tracked write 只改对应 Project 文件；写后重读并返回 effective snapshot。Global base 更新后旧 overlay 显示 stale，base 仍可读但严格 planning gate 可阻断。

## Task 3：Project overlay API 与文生图编辑器

**文件**

- 新增 `GET/PATCH /api/text-to-image/project-overlays`
- 新增 `TextToImageProjectOverlayPanel.vue` 并接入文生图分页
- 新增 API/UI contract test

**RED / GREEN**

- 所有 API 使用 Project-open + current user；客户端不提交 actor/path/base bytes。
- UI 同时展示 active base pair、Storyboard/Pattern overlay status、base/effective hashes、diagnostics 与 provenance 摘要。
- 两份 Markdown 分开编辑；“保存草稿”与“保存并应用”语义明确，stale/conflict/error 局部可见；无 localStorage 第二真相源。

## Task 4：Character / Outfit V2 strict contract 与 codec

**文件**

- 新增 `shared/text-to-image-character-visual.ts`
- 新增 `server/text-to-image/character-visual.codec.ts`
- 新增对应测试

**RED / GREEN**

- 固定完整字段集合、generic NovelAI resolutionScope、同文件 resolution/syntax refs 全覆盖且无 unused/cross-owner key。
- canonical renderer 固定字段/key/map 顺序；body/display names 不进入 `renderTagFactsHash`，fields/resolutions/syntax node 任一变化必须改变。
- outfitRefs containment、ownerCharacterId/characterId/目录 identity 在服务边界复验；codec 不接收路径猜测。
- NAI 权重/强调只允许转换为注册 Provider Grammar node；未知定界符保留在 proposal diagnostic，不进入 approved V2。

## Task 5：Project migration scan / resolve / journal / apply

**文件**

- 新增 `server/text-to-image/character-visual-migration.service.ts` 与 journal
- 新增 inspect/resolve/apply API 与文生图/角色详情 migration UI
- 新增 fixtures/tests

**RED / GREEN**

- 扫描当前 Project 已有旧角色/服装 Markdown，确定性拆原子并冻结 target base file hashes；没有 active index 只返回 pending_unresolved。
- active index ready 后用一次 context/run 的 Resolver 产生 terminal/review/block diff；逐项 approval 不能绕过 block/deprecated。
- apply 前复验 proposal hash、target hashes、identity/ownership/outfit refs；所有 V2 bytes 先 render/parse 后进入 prepared journal。
- 多目标 tracked write 可恢复：中断重放不覆盖用户后来修改；全部完成后 receipt 才标 completed。
- 标准 SillyTavern card/PNG 与 Context 结构化角色最终汇入同一 proposal；已有用户字段默认保留，视觉覆盖逐字段显式确认。

## Task 6：旧自由 Tag 运行链硬切

- 角色详情页不再提交任意 LLM provider/model 并直接覆盖 free-string Markdown；改为 Director/migration proposal 入口。
- Route B 读取器只接收 V2；旧 parser 只在 migration scan 内短暂存在，迁移入口完成后删除或内联为明确的 source reader。
- 断开并删除旧 `body-character-tags` / prompt-compiler 自由字符串运行消费；P3/P4 只消费 V2 typed facts。
- 静态测试约束 Profile/Skill/正文按钮无 Provider/Recipe/NovelAI 参数或角色 V2 apply 写权限。

## Task 7：验证与记账

- 运行 overlay codec/service/API/UI、character V2 codec/migration/journal/旧链清理聚焦测试与完整 typecheck。
- 更新同一 walkthrough、持续计划与 `PROJECT-STATUS.md`，记录计划偏差、迁移扫描数量与剩余 P3 边界。
- 未获授权前不做浏览器验证；不提交、推送或发布。

## 2026-07-20 实施进度

### 已完成：Project Overlay

- 新增两类 strict overlay codec、共享编辑 DTO、Project-open/tracked-write/CAS service 与 GET/PATCH API；缺文件只返回绑定当前 active companion hashes 的 pending 空草稿，不在读取时写盘。
- `draft` 保存强制 pending；`apply` 在服务端重建 approved hash，并用 P0 resolver 对整份 operation 做 fail-closed 校验。base 漂移、unknown/collision、half companion、selector identity 错配与并发 CAS 冲突均零部分写入。
- 文生图分页显示 active pair、base/effective hashes、review/effective state 与 diagnostics；两份草稿各自保存，另一份未保存编辑不会被覆盖。global publish 后由宿主 revision 重读 selector，不保存第二份全局配置。

### 已完成：Character / Outfit V2 与现有文件迁移

- 冻结 Character 12 字段、Outfit 4 字段、generic NovelAI scope、同文件 resolution/syntax 所有权、canonical 排序及 `visualPlanningFactsHash` / `renderTagFactsHash`。显示身份与 sourceText 驱动规划失效；完整 resolution evidence、字段 refs 和 typed weight node 驱动执行失效；`resolvedAt` 不制造虚假 stale。
- 新增严格 Markdown codec。正文只影响 file hash；显示名称不进入 render hash；unknown/missing field、unknown/unused/重复/cross-field key、model-specific snapshot 与自由 Provider 语法均拒绝。
- 旧 Markdown source reader 只存在于 migration converter：按逗号/换行拆原子，`((tag))` 显式转换为 `novelai-tag-weight`，未知宏/定界符 report-only。重复扫描产生稳定 migration/resolution/syntax identity。
- Project migration service 实现 `scan -> prepare -> resolve/review/block -> ready -> apply/resume`。candidate、report、resolution 和 apply journal 位于 Project `.nbook/text-to-image/character-visual-migrations/**` 并走 tracked write；无 active index 时旧文件保持原样，source CAS 漂移零覆盖，多文件中断按 source/target 精确 hash 幂等恢复。
- 文生图分页新增角色迁移面板；用户逐项审核 policy request、逐项接受全部 terminal diff 后才可 apply。API 注入当前用户 actor/approval identity，客户端没有 Provider、Recipe、NovelAI 标量或 target Markdown 写面。
- 新增 Route B V2-only registry：任何 legacy/无效 V2、缺失 outfit、character/outfit ID 或 owner 交叉引用都会 fail-closed，不调用旧 parser。

### 计划偏差与剩余 P2 边界

- 原计划把旧 detector/completion/placer 的物理删除放在 Task 6；冻结总规格把该删除门固定在 P4，且 P3/P4 替代 workflow 尚未完成。当前先建立 V2-only Route B registry，物理删除延后到 P4 同替代入口一次硬切，不建立 adapter。
- 现有 Project 角色/服装文件迁移已完成；标准 SillyTavern card/PNG 继续走仓库既有通用 importer，不在本模块猜测私有格式。TTP（text-to-picture）Context 中可确定识别的结构化角色/服装字段目前仍只进入 Storyboard report-only 统计，尚未汇入本 migration proposal；这是剩余 P2 缺口。
- 角色详情页的 LLM tag generation 仍会生成旧 source Markdown；在改为 proposal-only 入口前不能算 Task 6 完成。Route B registry 已确保这些文件不会被新 Director/Compiler 消费。

### 验证

- Project overlay + Character/Outfit V2 最终组合：`12 files / 40 tests passed`。
- 完整 `bun run typecheck`：exit code 0。
- 本纵切没有 Prisma schema 变化，因此未运行 generate。按约束未自动运行浏览器验证；未提交、推送、发布或操作前序暂存设计文档。
