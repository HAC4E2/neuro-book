---
schema: nbook.task/v2
taskId: t02-novel-memory-model-design
role: tasker
---

# 小说记忆模型设计与数据结构 spike

## 目标

把「小说剧情如何进入可检索的记忆结构」从设计文档推进到可运行的数据结构，并提供一个数据查看器，让开发者直接看模型装下真实剧情之后是什么样。

**定位是全新模型。** 不在 `packages/nb-memory/` 基础上演进，也不受其既有决策约束；spike 独立建库、独立验证。`nb-memory` 只作为先验参考。若本模型验证效果好，再单独讨论是否替换其模型。

本 Task 的代码只在 Task 目录内，是 spike 产物，不是业务源码：不写 `packages/`、不改公开 API、不建数据库、不接任何产品模块。

来源是开发者与 Agent 的一次长对话：从人类记忆的分类（情节记忆 / 语义记忆 / 个人语义）出发，推导一个用于 LLM 外部记忆的实体模型，再用样书第一章做落地检验。t01 提供了样书第一章的既有证据与 canonical 摘要。

## 产物

| 文件 | 是什么 |
| --- | --- |
| `memory-model.md` | 模型正文。核心五类与可选三类节点的字段定义、三条时间轴、上下文无关记法、抽取管线、检索架构、第一章推演、9 条设计裁决与 spike 验收判据。 |
| `schema.ts` | 数据结构 spike。`memory-model.md` 第 4 节的机器可读形态，附查询原语与 `validate()` 结构校验。 |
| `chapter-01.json` | 第一章数据集，**唯一真源**。人工装填，符合 `nbook.novel-memory/v2-spike`。 |
| `viewer.html` | 数据查看器。三栏检视器 + 力导向图 + 叙述位置滑杆 + 状态过滤 + 结构校验面板。滑杆按 `Individual.since` 切片，`Kind` / `Predicate` 的可见性由派生得出。双击打开，也可拖入其它数据集。 |
| `chapter-01-graph.html` | 设计说明页。手工排版的第一章完整体，用来讲清楚每个字段为什么存在；「切片」一节列出八类记录各自怎么处理叙述位置。 |
| `scripts/build-viewer.ts` | 校验 `chapter-01.json` 并把它注入 `viewer.html`。数据改了要跑一次。 |
| `scripts/smoke-viewer.ts` | 两个页面的无头冒烟测试（jsdom）。 |

## 怎么跑

```bash
# 校验数据集并同步进 viewer（改了 chapter-01.json 之后必跑）
bun run .agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/build-viewer.ts

# 无头冒烟（必须用 node，bun 的 vm 与 jsdom 冲突）
node .agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/smoke-viewer.ts
```

两个 HTML 都是单文件、零依赖、零构建，双击即可打开。

## 开发者参与

2026-08-28：设计文档审查通过。两条结论已写回：

1. `Summary` / `Question` / `Mention` 是**可选三类**，不是核心模型；核心是 `Kind` / `Individual` / `Predicate` / `Fact` / `Episode` 五类。
2. 第 11 节的 9 条设计选择全部采纳，其中 D5、D7 为「同意方向、结论待实测」，分别落到 spike 的 S2 与 S1。

随后开发者要求先 spike 数据结构、加数据查看器、页面改亮色，本轮据此交付上表七个文件。

**待看的是查看器。** `viewer.html` 里最能说明问题的是叙述位置滑杆：拖到第 5 段，`codex` 只叫「黑色典籍」；拖到第 27 段，专名揭晓，节点当场改名。这是 `Alias.since` 在起作用，也是这个模型防止「第一章检索泄漏第二十章身份」的机制。

滑杆现在切的是整张图，不只是名字：拖到第 1 段，图是空的；第 5 段 4 个实体、1 个谓词；读完 9 个实体、19 个谓词。这是 `Individual.since` 加上 `schema.ts` 的 `snapshotAt()` 在起作用。`Kind` / `Predicate` 不打位置戳——它们是词表不是内容，`snapshotAt()` 切片时原样保留，查看器只是不画没人用的孤立节点。左栏 Tab 的徽章显示「当前可见 / 总数」。

## 完成门禁

- `schema.ts` 的 `validate()` 与 `viewer.html` 内置的独立校验器都对 `chapter-01.json` 报 0 错误。
- 冒烟测试全部通过。
- HTML 与 `memory-model.md` 的字段、状态取值、时间轴语义保持一致。
- 每条结论标明来源（对话推导 / 未实测），不把推论写成实证结论。

## 非目标

- 不写正式 Spec 或 ADR，不改 `packages/` 或任何业务源码，不建数据库。
- 不声称单章推导已验证全书或跨作品适用性。
- 不做性能与规模验证，规模不是本次约束。
- `chapter-01.json` 全部人工装填，不是抽取管线输出，不构成任何召回或准确率证据。
- 冒烟测试只覆盖脚本执行与渲染结构，不覆盖视觉呈现；浏览器人工验收未获授权，未执行。

## 允许文件

- `README.md`（本文件）
- `memory-model.md`（模型正文）
- `schema.ts`（数据结构 spike）
- `chapter-01.json`（第一章数据集）
- `viewer.html`（数据查看器）
- `chapter-01-graph.html`（设计说明页）
- `scripts/build-viewer.ts`（校验与注入）
- `scripts/smoke-viewer.ts`（无头冒烟）

样书只读。**逐字正文的规则在 2026-08-29 由开发者改写**：显式登记的样本章节可以进 Git（第一章正文在 `t01/evidences/chapter-001-source-normalized.txt`），批量抽取产出的逐字层不进；口径见 `t03/extraction-pipeline.md` 第 2 节 R4。本 Task 的数据集与 HTML 仍只使用结构化剧情要素和释义，不是因为原文不能进，而是因为 `Episode.content` 要能被检索命中——`content` 是释义，`Episode.sourcePointer` 是原文段落定位（第 N 段即上述文件的第 N 行）；查看器生成器会拒绝缺失或非法指针，并对嵌入数据做 HTML-safe 转义。
