# Route B P2 Deterministic Import Foundation Implementation Plan

> **执行约束：** 本计划在 P0 独立审查无遗留 P0/P1 后开始生产实现；按 `test-driven-development` 逐项 RED/GREEN。用户禁止提交，因此不执行 commit/push。

**Goal:** 把现有宽松前端 ST 设置导入硬切为 server/shared 唯一的确定性 TTP（text-to-picture）Storyboard inspect 流程，安全地产出可审查但不可批准的 `pending_unresolved` Storyboard + Tag Pattern companion package、Recipe proposal 与 report/journal。

**Architecture:** Shared 层定义 import DTO/state/report；server 先在原始 bytes 上做路径/大小/hash/strict JSON/redaction，再以 deterministic classifier 生成有限候选和稳定 source identity。无 active Tag index 时只允许 `PendingTagAtom` 存在于 import candidate/report，正式 Pattern contract 不接受 unresolved atom；因此本切片用独立 candidate schema 渲染 pending companion，不伪造 terminal resolution。后续 Danbooru/Resolver 切片把同一 import 推进到 `pending`。

**Hard boundaries:**

- 只接受显式 `upload/*.json`，<=16 MiB；不扫描目录。
- duplicate JSON key、`__proto__`/`prototype`/`constructor`、深度/entry/单项长度超限均拒绝。
- raw bytes 只在内存 hash；任何持久化前完成 secret redaction，archive 只保存 canonical sanitized JSON。
- 七类 classifier 固定；`style_quality` 只进入 Recipe proposal；disabled 永不激活。
- 本计划不下载或解析 TTP `tagData`，不复用现有 Tag Vocabulary importer。
- 无 active Tag index 不允许 approve/publish；本切片不建立 mock index 或自由 Tag fallback。

### Task 1: Import shared DTO/state contracts

**Files:**

- Create: `shared/text-to-image-storyboard-import.ts`
- Create: `shared/text-to-image-storyboard-import.test.ts`

**RED/GREEN:**

- versioned import state union：`uploaded|inspected|converting|pending_unresolved|resolving_tags|pending|publishing|applied|failed|rejected|stale`。
- strict source identity、entry allowlist、七类 classifier、macro token、PendingTagAtom、Recipe proposal、report counts/diagnostics、candidate package envelope。
- 状态迁移函数拒绝非法跳转；`pending_unresolved -> publishing` 永远非法。
- 所有 DTO 无 Provider/Recipe mutation、secret、最终 Prompt 或任意文件写权限字段。

### Task 2: Strict JSON reader and secret redaction

**Files:**

- Create: `server/text-to-image/ttp-storyboard-json.ts`
- Create: `server/text-to-image/ttp-storyboard-json.test.ts`

**RED/GREEN:**

- UTF-8/size/depth/entry/string hard caps。
- streaming/token-aware duplicate-key 与 prototype-pollution key 拒绝；不得只依赖 `JSON.parse` 丢失重复 key 证据。
- direct entries / 单 dynamic wrapper 两种 root；多 root/unsupported shape 稳定错误。
- raw/sanitized SHA-256 分离；secret path redaction 在任何落盘 DTO 之前发生，report 只记 path。
- canonical sanitized bytes 稳定、原输入不被修改。

### Task 3: Deterministic inspect/classifier

**Files:**

- Create: `server/text-to-image/ttp-storyboard-inspector.ts`
- Create: `server/text-to-image/ttp-storyboard-inspector.test.ts`

**RED/GREEN:**

- entry allowlist、explicit id/map key/fallback canonical identity、sourceOrder/JSON Pointer/enabled/role/trigger semantics。
- 七类分类与附加安全/角色/输出模板标记；相同输入稳定。
- disabled 完整示例保持 inactive；未知/随机宏进入 blocking/report。
- 最多 64 entries / 80k chars 的确定性 chunk manifest，不截断、不丢 entry。
- `style_quality` 只生成 Recipe proposal，trigger alias 不进入 Pattern executable groups。

### Task 4: Pending companion package builder

**Files:**

- Create: `shared/text-to-image-storyboard-candidate.ts`
- Create: `server/text-to-image/storyboard-candidate.service.ts`
- Create tests for both.

**RED/GREEN:**

- 每份可解析 JSON 始终产生 Storyboard candidate + `patterns: []` 或 unresolved Pattern candidate + report。
- `NO_USABLE_STORYBOARD_RULE` blocking；空 Pattern 本身非 blocking。
- ruleId/patternId 只由 sourceEntryId + registered kind + registered semanticSlot 派生。
- pending `candidatePackageHash` 精确绑定 Storyboard semantic、candidate Pattern planning/render 与 diagnostics；Recipe proposal 使用独立 hash 检测漂移，不把只读提议或 package identity 反向写入 companion 身份。
- unresolved atom 不能 parse 成正式 `TagPatternSetSchema`，从类型上阻止误发布。

### Task 5: Project inspect service and import journal

**Files:**

- Create: `server/text-to-image/storyboard-import.service.ts`
- Create: `server/text-to-image/storyboard-import.service.test.ts`
- Create: `server/text-to-image/storyboard-import-journal.ts`

**RED/GREEN:**

- 精确 containment：仅当前 Project `upload/*.json`，不接受目录、嵌套扫描、绝对路径或其他扩展名。
- 同 `rawSourceHash + converterVersion` 幂等恢复同 importId。
- archive 写入前确认 sanitized；journal 分阶段可重放，失败不影响当前 approved selector。
- Project source 改变/删除返回 `STORYBOARD_IMPORT_SOURCE_CHANGED`；越限/shape/JSON 使用稳定错误码。

### Task 6: Fixed Skill/Profile convert boundary

**Files:**

- Create: `assets/workspace/.nbook/agent/skills/novel-import-ttp-storyboard-preset/SKILL.md`
- Create: `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- Extend: `shared/agent/illustration-director.ts`
- Add artifact/static contract tests.

**RED/GREEN:**

- 首版 Profile 只开放 `convert-preset` 所需脱敏候选读取与 proposal submit；无 shell、任意文件写、Provider/Recipe mutation、任意网络。
- operation strict input/output、max turn/tool/tag limits；未知字段整份拒绝。
- Skill 只描述工作流，核心 parser/状态机/写入不在 Skill 中复制。

### Task 7: Inspect API and pending preview UI

**Files:**

- Create API under `server/api/text-to-image/storyboard-imports/`.
- Add focused components under `app/components/novel-ide/text-to-image/`.
- Modify `NovelTextToImagePanel.vue` only as a host.

**RED/GREEN:**

- 用户显式选择 upload JSON；显示七类统计、disabled/unknown macro、Recipe proposal、两份 pending diff 与 `TAG_INDEX_NOT_READY`。
- 无“上传即激活”；approve 按钮在 `pending_unresolved` 禁用且错误出口明确。
- UI 不读取原始 secret、不保存第二份 candidate/localStorage 真相。

### Task 8: Verification and hard-cut bookkeeping

- 聚焦 tests + Profile artifact compile + `bun run typecheck`。
- 静态搜索确认新 API/UI/Profile/Skill 无 `tagData` 路径、无 Recipe/Provider mutation。
- 现有 `text-to-image-st-ttp-import.ts` 只有在角色 migration 和新 preview 全部接管其消费者后删除；不建立 adapter。
- 更新同一 active walkthrough 与 `PROJECT-STATUS.md`，明确这里只到 `pending_unresolved`，未完成 Danbooru/Resolver/approve/publish。
- 浏览器验证仍等待用户明确授权。
