# Nightly Audit / 夜间自主巡检

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- Skill 本体：`~/.claude/skills/night-audit/SKILL.md`（用户级，跨仓库通用，**不在本仓库版本控制内**）
- 实现计划：`~/.claude/plans/snug-jumping-duckling.md`
- 运行时状态文件：本目录下 `AUDIT-STATUS.md` / `CHECKLIST.md` / `FINDINGS.md` / `rounds/`，由 skill 首轮自动生成

## User Request / Topic

- 在人类夜间休息时派发任务，持续详细检查当前项目。任务要能一直运行，随时可通知、可恢复。
- **只做检查和简单测试**。不动业务代码，不碰浏览器测试等可能导致系统崩溃或难以恢复的操作。
- skill 需要指定一个目录作为任务追踪目录。
- 通过 goal 或 loop 实现；每轮做了什么都要写进 walkthrough。
- 任务需要边规划边执行——Agent 自主选定方向，避免盲目审查。因此需要一个类 `PROJECT-STATUS.md` 的滚动状态文件。
- 调研 Claude Code 是否支持 loop / 自优化提示词 / Harness 自优化。

## Goal

让夜间闲置额度产出**可被人在早晨 5 分钟内消费**的巡检发现账本，且第二天可无缝续跑。

- **Outcome**：`FINDINGS.md` 持续积累去重后的真实发现；`AUDIT-STATUS.md` 的覆盖率地图逐夜推进。
- **Verification surface**：`git status` 确认改动只落在本目录；`rounds/` 文件能还原每轮的选向理由与执行过程。
- **Constraints**：不改业务代码、不改 git 状态、不起长驻进程、不跑全量测试套件。
- **Boundaries**：只允许写 `docs/tasks/127-nightly-audit/`。
- **Iteration policy**：每轮读 `AUDIT-STATUS.md` 定位 → 选一个方向 → 只读调研 + 受限验证 → 记账 → 回写状态与下一轮入口。
- **Blocked stop condition**：连续 3 轮无法推进时 `PushNotification` 通知并停止。

## ADR / Decisions / Discussion

### 调研结论：Claude Code 的 loop 能力

`/loop` 是内置 skill，签名 `[interval] [prompt]`，底层两套机制：

| 模式 | 触发 | 底层工具 | 特性 |
|---|---|---|---|
| interval | `/loop 20m <prompt>` | `CronCreate` | 到点重新入队，**不依赖上一轮成功收尾** |
| dynamic | `/loop <prompt>` | `ScheduleWakeup` | 模型自定间隔（60–3600s），**回合崩溃则 loop 死** |
| autonomous | `/loop` | sentinel `<<autonomous-loop>>` / `<<autonomous-loop-dynamic>>` | 运行时解析为自主循环指令 |

**关于自优化**：Claude Code **没有内置的 prompt 自改写机制**，loop 每轮把同一段 prompt 原样重新入队。本任务用两条途径替代：状态外置到磁盘（主力，prompt 恒定而上下文自演化，可审计可纠偏）+ 单文件有限自改写 `CHECKLIST.md`（只增不删，防漂移退化）。

### 四项拍板（勿重议）

| 项 | 决定 | 理由 |
|---|---|---|
| 循环驱动 | cron interval，间隔 **4m** | 间隔远短于单轮耗时 ⇒ cron 退化为「一轮结束立刻接下一轮」，零空闲；同时保留撞额度后自愈能力 |
| 追踪目录 | skill 接受目录参数，不绑定本仓库 | skill 装在用户级，跨仓库通用 |
| 写入门禁 | 仅靠 skill 纪律，不写 PreToolUse hook | 避免影响白天正常开发；最终防线是人工 `git status` 复查 |
| 巡检方向 | Agent 自主选定 + 覆盖率地图约束 | 既自主又不盲目重复 |
| 运行窗口 | `until <时刻>` / `for <时长>`，首轮解析成绝对时间戳落盘 | 见下节 |

### 运行窗口与自动停止（2026-07-27 追加）

`/night-audit <dir> until 07:00` 或 `for 6h`，到点自动收尾并 `CronDelete` 自己的循环。另有 `stop` 子命令供手动即时收尾。

两个设计要点：

1. **首轮解析一次，存绝对 epoch，之后每轮只做数值比较。** 若每轮重新解释相对时间，晚上 23:00 下达的 `until 07:00` 跨零点后会被算成「今天 07:00（已过去）」而秒停。解析命令已实测（`date -d "07:00"` + 过点顺延次日的条件判断），今日 01:28 与模拟 23:00 两种情形均正确。
2. **截止时间是软的。** cron 只在 REPL 空闲时 fire，到点时正在跑的一轮不会被打断。实际停止时间 = 截止时间 + 最多一轮（约 15 分钟）。需要硬停只能人工中断。

### 影响设计的两条机制事实

1. **cron 是往当前会话重新入队，不是开新会话。** 整夜是一个不断变长、反复 compact 的会话。⇒ 会话记忆不可信，每轮必须全文重读 `AUDIT-STATUS.md`；每轮在会话里只留 2–3 行摘要以延缓 compact。
2. **本仓库测试基线本身是噪音源。** 若不登记基线，夜审每晚会稳定产出几十条假发现。

## Verification / Test

分四步，前三步人工在场，确认后才允许通宵：

1. **Bootstrap 轮**：`/night-audit docs/tasks/127-nightly-audit`。检查目录骨架、覆盖率地图切分、噪音基线是否完整。
2. **第 1 轮正常巡检**：再跑一次。检查 `rounds/` 完整性、`AUDIT-STATUS.md` 回写、`git status` 确认无越界写入。
3. **第 2 轮续接**：第三次跑。**重点验证读了上轮「下一轮入口」并换了方向，没有重复劳动。**
4. **cron 堆积实测**：`/loop 3m` 空跑约 15 分钟，观察 REPL 忙碌期间错过的刻度是跳过还是堆积成连续多次 fire。文档未写死此行为；若堆积则需调长间隔。确认后再上 `/loop 4m`。
5. **自动停止实测**：用一个短窗口（如 `for 12m`）配 `/loop 3m` 跑，验证到点后确实进 Phase 7、`CronDelete` 成功、循环真的不再 fire。**重点确认 `/loop` 创建的 job 能被 `CronList` 看到并删掉**——`/loop` 底层调 `CronCreate`，理论上可见，但未实测。若删不掉，Phase 7 会如实报告并要求人工停。

## Implementation Walkthrough

### 2026-07-27 首轮实现

已完成：

- 调研 Claude Code loop 能力：从 CLI 二进制提取 `/loop` 签名与 sentinel 字符串，读取 `CronCreate` / `ScheduleWakeup` / `Monitor` / `PushNotification` 工具契约，确认 session-only、REPL-idle-only、7 天过期三项限制。
- 新建 `~/.claude/skills/night-audit/SKILL.md`（用户级）：Phase 0 bootstrap + Phase 1–6 轮次协议 + 禁令清单 + 预算失败纪律 + 通知策略 + 停止恢复 + 文件契约。
- 新建本任务目录 README。

**与计划的出入**：无。计划中的追踪目录文件（`AUDIT-STATUS.md` 等）按设计由 skill 在 Phase 0 生成，本轮未预先手写。

**待办**：验证四步尚未执行，需人工发起。

## Bootstrap 输入（供 Phase 0 使用）

- 允许命令白名单候选：`bun run typecheck`、`bun run runtime:typecheck`、`bun run manager:typecheck`、`vitest run <具体路径>`
- **已知噪音基线**（必须写进 `AUDIT-STATUS.md`）：
  - 全量 vitest 套件基线不稳定，41–53 个文件失败与具体改动无关，用例总数本身浮动
  - `typecheck` 与 `vitest` **不可并发**：nuxt 会重写 `.nuxt/tsconfig` 造成假失败
  - session / harness 套件本身有 5–7 项 flaky
  - `bun test` 子串过滤会误匹配 product 与旧副本，须用精确路径
- 初始模块切分建议：`app/`、`server/`、`shared/`、`scripts/`、`packages/neuro-book-manager/`、`assets/workspace/`、`docs/` + `reference/`（文档漂移）

## TODO / Follow-ups

- [ ] 执行验证四步（bootstrap 轮 → 正常轮 → 续接轮 → cron 堆积实测）
- [ ] 首晚通宵后复盘：发现质量、假阳性率、单轮预算是否合适
- **不同步 `PROJECT-STATUS.md`**：夜审不改业务代码，不触发仓库级状态同步要求。仅当 skill 设计本身变更时更新本 README。

## 已知限制

- 会话整夜只增不减，反复 compact 带来成本与性能代价；loop 内无法自动换 session。
- cron job **7 天自动过期**，长期使用需每周重开。
- 终端关闭或机器休眠 = 循环中断，只能靠磁盘状态第二天续跑。
- 无 hook 硬门禁，越界写入的最终防线是人工 `git status` 复查。
