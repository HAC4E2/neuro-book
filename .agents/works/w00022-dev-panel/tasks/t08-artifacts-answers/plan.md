# t08 实施计划：产物、提问与答复（命令行）

编码子代理 2026-10-12 写，设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，0 阻断、7 重要、13 建议）之后按主 Agent 的处理意见改定，逐条对应见文末“设计审查的处理”。范围以 [实施计划的 t08 一节](../t03-design/plan.md#t08-产物提问与答复命令行)（场景 1 到 9）为准，设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第三节、待决问题 4 到 7（开发者已按推荐同意），以及主 Agent 定的三条调整：`askedBy` 不入库、测试只在临时仓库发布、写入都走 t06 的写事务。

## Context

- **要解决的问题**：Agent 要开发者拍板的事现在只能在终端里问、在终端里答，记录里查不到；评审板的“要你定”没有机器可读的格式，被后一轮取代的问题仍写着待定，待答数虚高。t08 让 Agent 能把提问发布成记录、读到入库的答复、确认采纳，每道题都有结局；面板（t09、t10）与通知（t11）读写同一套文件。
- **已定的决定**：答复入库、只追加（决定 12）；Task 目录里的 Markdown 算文档类产物，按文件索引（待决问题 5）；挂在 Task 上的提问存成没有页面的产物（待决问题 6）；“已采纳”的确认入库，与写了决定的 Task README 同一个提交（待决问题 7）；“最近更新”的取法见下文“最近更新”（待决问题 4）；图片单张约 300 KB、每个 Task 约 5 MB（决定 13）；纯讲解页没有“已看”（决定 6）。
- **主 Agent 定的调整**：
  - `askedBy`（租约与会话快照）不写进入库的 `versions/vN.json`，放 `.local/agent/run/` 下、按产物版本对应；入库的发布记录、答复、确认里都没有指向会话的字段。用 t07 导出的 `getLease`、`evaluateLease`。
  - 测试只在临时仓库里发布；不在真实仓库发布，也不改真实的 t03 评审板。场景 1 用评审板的一份拷贝做夹具。
  - 提问、答复与确认的写入都走 t06 的写事务；“有新答复”的判定要能给 t11 的通知复用。
- **前提**：t06、t07 已在集成分支（`aff36ea22`，之后另有 t07 测试收尾的一个提交）：写事务（`createFile` 独占创建、`includePaths`）、过渡期读法、`readProjectStatus`、调用者解析、`touchCallerLease`。
- **工作方式**：同 t07。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；记录只在主工作区改。
- **约束**：核心只用 Node 兼容 API（根脚本测试在 Node 下导入）；只支持 Linux。

## 环境核实（2026-10-12，本机只读）

| 事项 | 结论 | 怎么查的 |
|---|---|---|
| 可复用的 HTML 解析器 | `parse5@8.0.1` 已在 `bun.lock` 里（根依赖 `jsdom@29.1.1` 的依赖），唯一依赖 `entities@8`，ESM，支持 `sourceCodeLocationInfo`（报错能带行列）。解析 56 KB 的 t03 评审板，Node 25 毫秒、Bun 22 毫秒；评审板 16 个 HTML 共 235K 字全部解析约 53 到 62 毫秒（审查实测）。元素被隐式闭合时 `sourceCodeLocation.endTag` 不存在；不进入 `<template>`、`<noscript>` 的内容 | `bun.lock`；探针（已删）；审查实验 |
| 其它候选 | `jsdom`（根依赖）与 `happy-dom@20.11`（nb-ui、llmlint 的开发依赖）是整套 DOM，太重；Bun 的 `HTMLRewriter` 只在 Bun 下有，核心要在 Node 下跑，不能用 | 各包 `package.json` |
| 已有产物 | `master` 上只有两个 Task 有 `artifacts/`：t03 的 `review/`（`index.html` 56 KB、`model.html`、`r1/` 到 `r3/` 的子页由 `assets/data*.js` 渲染、`build.ts`，没有图片，共约 560 KB）；w00017 t80 的 `review/`（20 多张 WebP，最大 165 KB，`h2` 后跟兄弟元素的扁平结构）与 `omp-review-1/`（`report.md` 与 `brief.md`，即 Markdown 的审查报告）。都没有 `versions/` 与 `answers/` | `find .agents/works -path '*/artifacts/*'`；审查 |
| 评审板的标题 | t03 与 t80 的题目 `h2` 都带徽标（`<span class="badge">`、`<span class="tag done">`）；t03 的选项容器 `div.cand` 整段文字有 138、155 个字 | 读 `index.html`；审查 |
| `data-nb-*` 前缀 | nb-ui 与主应用已在用 13 种 `data-nb-*` 属性（例如 `data-nb-theme`）；所以提问标记改用 `data-nbdev-*` | 审查 |
| Task 目录里的 Markdown | `master` 上 152 个 Task 目录里，README 之外的第一层 `.md` 共 27 个（需求分析、领域模型、调研、计划） | `find .agents/works -mindepth 4 -maxdepth 4 -name '*.md'` |
| t80 的来源 | w00017 的记录来自分支，但 t80、t81 只在 `master` 上（经 t05 迁来），`status` 判它们的来源是 `master`；`setRecordStatus` 允许写它们 | 审查实测 |
| 写事务的边界 | 锁之前先读时钟（`now`）；`createFile` 只写 UTF-8 文字；`includePaths` 要求路径在 `.agents/works/` 下且文件存在，所以已删除的文件不能一起提交；提交后核对提交里的路径与预期一致 | `src/core/transaction.ts` |
| Claude Code 的后台任务 | `run_in_background` 起的命令退出时会唤醒会话；单个后台任务能活多久**没有核实** | 工具说明 |

## 关键设计

### 目录与文件

```text
.agents/works/<workId>/tasks/<taskId>/
├── *.md                                   # 文档类产物：按文件索引，没有发布记录
└── artifacts/
    ├── <artifactId>/                      # 有页面的产物
    │   ├── index.html  r1/  assets/ …     # 页面文件：会话直接写在主工作区
    │   ├── versions/v<N>.json             # 发布记录，nbdev 写，之后不改
    │   └── answers/
    │       ├── <答复 id>.json              # 答复，只追加
    │       └── ack-<id>.json              # 确认
    └── questions/                         # Task 的提问集：没有页面的产物，保留名
        ├── versions/v<N>.json
        └── answers/…

.local/agent/run/provenance/<与入库文件相同的相对路径>.json   # 这个入库文件由哪个会话写的
```

- `artifactId` 用 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`，最长 48 个字符），在 Task 内唯一；`questions` 保留给 Task 的提问集。
- `versions/` 与 `answers/` 只由 nbdev（以后加上面板）写；会话只写页面文件。
- **答复 id 与确认 id**：形如 `20261012T213012345Z-1a2b3c4d`（UTC 毫秒时间加 8 位 hex），确认文件名是 `ack-` 加同样格式的 id。id 在写事务的锁内重新读时钟生成，并保证单调：时间部分取 `max(当下, 这个 answers/ 目录里最大的 id 的时间 + 1 毫秒)`。所以 id 的字典序就是落位的顺序。开发者按下提交的时刻另记在 `submittedAt` 里，与 id 分开。
- Work 级的产物（Work 目录下的 `artifacts/`）本片只在读取时索引，不提供发布命令：命令都以 Task 为单位，现在也没有用例。

### 发布记录 `versions/v<N>.json`

```json
{
  "schema": "nbdev.artifact-version/v1",
  "workId": "w00022-dev-panel", "taskId": "t03-design", "artifactId": "review",
  "version": 2, "supersedes": 1, "action": "publish",
  "kind": "design", "title": "开发面板评审板", "state": "open",
  "entry": "index.html", "contentHash": "<sha256>",
  "questions": [
    {"id": "home-layout", "type": "single", "label": "首页的 Work 区用卡片还是表",
     "options": [{"value": "cards", "label": "A 每个 Work 一张卡片"}, {"value": "table", "label": "B 一张表"}],
     "required": true, "recommend": ["cards"], "origin": "markup", "page": "index.html", "about": null,
     "since": 1, "outcome": null},
    {"id": "home-order", "type": "single", "label": "……", "options": [], "required": true, "recommend": [],
     "origin": "markup", "page": "index.html", "about": null, "since": 1,
     "outcome": {"kind": "superseded", "in": 2, "by": null}}
  ],
  "publishedAt": "2026-10-12T21:30:00.000Z"
}
```

- Proposal 的字段除 `askedBy` 外全部保留；新增三个字段：`action`（这一版由哪个动作产生：`publish`、`close`、`ask`、`withdraw`、`supersede`）、每道题的 `origin`（`markup` 来自页面标记，`ask` 来自 `nbdev ask`）与 `since`（题号第一次出现的版本）。`since` 让 t11 找到提问者：`since` 那一版的 provenance 就是提问的会话。
- **结局** `outcome`：`null`（活的），`{kind: "withdrawn", in: N, reason: "explicit" | "closed"}`，或 `{kind: "superseded", in: N, by: null | {workId, taskId, artifactId, questionId}}`（`by` 存规范化的完整 id，不存 `w00022` 这类简写；`null` 表示被本版的页面取代）。
- **最新一版带全部题**：被取代、撤回的题也留在最新一版里。读状态只看最新一版与答复，不用回放历史；`readArtifact` 也能读指定的一版（t10 按开发者打开的那一版校验取值）。
- `kind` 取 `design`、`report`、`review`；Task 提问集的 `kind` 是 `questions`，`entry` 与 `contentHash` 为 `null`。第一次发布必须给 `--kind`，之后缺省沿用上一版。
- `title`：第一次发布取 `--title`，否则取入口页的 `<title>`，再否则用 `artifactId`；之后缺省沿用上一版，给了 `--title` 才改。
- **非发布动作**（`ask`、`withdraw`、`supersede`、`close`）生成的新版本沿用上一版的 `contentHash`、`entry`、`title`、`kind`，页面不重新解析、页面改动不提交。
- `contentHash`：产物目录里 Git 会跟踪的文件（`git ls-files -z --cached --others --exclude-standard`，去掉 `versions/`、`answers/`，只算磁盘上还在的），路径相对产物目录、按 UTF-8 字节序排序，对“路径、NUL、文件 sha256、换行”逐行求 sha256；遇到符号链接就拒绝发布（`unsafe_path`）。t09 用同一算法（导出的 `artifactContentHash`）复算。Proposal 写的是“入口与它引用的本地文件”；改成整个目录，因为评审板的子页是经 `<a>` 与 `<iframe>` 引用的，逐个追引用既复杂又容易漏。
- **内容与题都没变就不出新版本**：除 `version`、`supersedes`、`action`、`publishedAt` 之外与最新一版相同时，不写文件、不提交，输出 `unchanged: true`（照常续期租约）。`--force-version` 时照样出新版本（提交失败后的补救，见“命令合同”）。
- 入口可以是 `.md`（例如 t80 的 omp 审查报告 `report.md`）：标记只从 `.html` 页里解析，这种产物的题用 `nbdev ask --artifact` 登记。

### 提问标记

写在产物目录里任意一个 `.html` 页上（不只入口页：题只写在子页上时也不会被漏掉），题号在整个产物内唯一。属性前缀是 `data-nbdev-*`：`data-nb-*` 已被 nb-ui 用了 13 种，从 Lab 存下来的静态稿会撞名。

| 写法 | 含义 |
|---|---|
| `data-nbdev-question="<题号>"` | 一道题的范围，放在包住这道题的元素上（通常是 `section`），必须写显式的结束标签。题号 `^[a-z0-9][a-z0-9-]{0,62}$`；题意变了就换题号 |
| `data-nbdev-type` | 必填：`single`、`multi`、`text`、`confirm` |
| 题目 | `data-nbdev-label="…"`；没有时取范围内第一个 `h1` 到 `h6` 的文字（空白折叠），跳过带 `data-nbdev-skip` 的元素（徽标加上它就不进题目）。超过 200 字报错 |
| 选项 | 范围内带 `data-nbdev-option="<值>"` 的元素。选项名依次取：它的 `data-nbdev-label`、它里面第一个标题、它自己的文字（同样跳过 `data-nbdev-skip`）；超过 80 字报错，提示写 `data-nbdev-label`。也可以在题上写一行 `data-nbdev-options`（若干个 `值:名称`，用竖线分隔）；`data-nbdev-options="@review"` 展开成“改（`fix`）、不改（`skip`）、要讨论（`discuss`）”，给审查报告的每条意见用 |
| `data-nbdev-optional` | 选答；缺省必答 |
| `data-nbdev-recommend="<值>[,<值>]"` | 推荐的选项（可选），面板与 `answers` 输出里标出 |
| `data-nbdev-skip` | 取题目、选项名的文字时跳过这个元素（徽标、按钮） |

- `single`、`multi` 至少两个选项，选项值在题内唯一、用与题号相同的字符集；`text`、`confirm` 不能有选项。`confirm` 的答复是 `true` 或 `false`。
- 题不能嵌套；题外出现 `data-nbdev-option` 算错，报错提示“可能是 HTML 自动闭合造成的（例如 `p` 里放了块级元素，`p` 被提前结束）”。题的范围元素没有显式结束标签时报 `question_not_closed`，带行号：parse5 隐式闭合时不报错，只有 `endTag` 缺失可查。
- 页面里没有任何 `data-nbdev-question` 就是纯讲解页，不进收件箱。产物目录里的 `.js`、`.mjs` 文件或内联 `<script>` 里出现 `data-nbdev-question` 时给 `questions_in_script` 警告：脚本或模板渲染出来的题解析不到。
- 解析出的每个问题都带页面与行号；任何一处不合规，发布整体失败（`invalid_questions`，退出码 2），`details.problems` 逐条给出页面、行列、题号、问题码（如 `question_not_closed`、`option_outside_question`、`label_missing`、`option_label_too_long`）与原因。成功时输出列出解析到的每道题（题号、类型、选项值），人读输出也逐行列出，写错的标记能当场看出来。
- 扁平的评审板（`h2` 后跟兄弟元素，例如 t80）要先给每道题包一层 `section` 才能加标记，Skill 里写明。
- **例子页** `packages/dev-panel/docs/examples/questions.html`：四种类型、`@review`、选答、推荐、`data-nbdev-label`、`data-nbdev-skip` 各一例；L1 测试解析这一页并断言结果，文档与解析器不会走样。片段：

```html
<section data-nbdev-question="home-layout" data-nbdev-type="single" data-nbdev-recommend="cards">
  <h2><span class="badge warning" data-nbdev-skip>待定</span>首页的 Work 区用卡片还是表</h2>
  <div data-nbdev-option="cards" data-nbdev-label="A 每个 Work 一张卡片"><a class="btn">打开</a> …</div>
  <div data-nbdev-option="table"><h3>B 一张表，按 Work 分组</h3> …</div>
</section>
<li data-nbdev-question="review-3" data-nbdev-type="single" data-nbdev-options="@review">
  <h3>第 3 条：锁的接管没有核对持锁者</h3> …
</li>
<section data-nbdev-question="naming-note" data-nbdev-type="text" data-nbdev-optional><h2>命名有没有别的想法</h2></section>
<section data-nbdev-question="approve-spec" data-nbdev-type="confirm"><h2>批准把草稿晋升为 Spec</h2></section>
```

### HTML 解析器

用 `parse5`，在包的 `dependencies` 里声明 `^8.0.1`。它已在 lockfile 里（jsdom 的依赖），根目录 `node_modules` 里已有，合入后不必重装；按规范解析，与浏览器看到的结构一致；能报行列；纯 JS，Node 与 Bun 都能跑。只遍历元素与属性、取文字，不执行脚本、不加载外部资源。**只在发布路径里按需导入**（`await import("parse5")`）：`status` 与其它读取不加载它（顶层导入会让 `status` 多 8 到 20 毫秒）。

同一次遍历顺带收集页面引用的本地文件（`src`、`href`、`srcset`、`poster`；跳过带协议的地址、`data:`、纯 `#…`），先去掉 `#…` 与 `?…` 再判断：目标不存在的给 `missing_reference` 警告；指向产物目录之外的给 `reference_outside_artifact` 警告（不在 `contentHash` 的范围内，t09 的产物来源也未必提供）。

### 结局与状态现算

每道题的状态由最新一版与全部答复现算：

1. `outcome` 是撤回或取代：`withdrawn` 或 `superseded`（附取代者）。
2. 否则取这道题最新的一份答复（按答复 id）：取值**按最新一版的题目定义**校验合法，就是 `answered`，并标出这份答复针对哪一版（“针对 v1”）；不合法就回到 `open`，同时列出那份旧答复并标 `stale_value`（不往前找更早的答复）。
3. 否则 `open`。

产物层面另算：`openRequired`（`open` 的必答题数）；**未确认的答复**是集合差，答复 id 不在任何一份确认的 `answers[]` 里就算未确认（`through` 只用于显示）；采纳状态：有未确认的答复为“等会话采纳”（`waiting`），有答复且都已确认为“已采纳”（`adopted`），没有答复为 `none`。

**新版本怎么生成题表**（纯函数 `nextQuestions`，L1 全覆盖；在写事务的锁内算，见“写入的公共前置”）：

| 情形 | 处理 |
|---|---|
| 页面里的题号在上一版里是活的 | 沿用 `since`，题目、选项用新的定义；改了选项后旧答复的取值不再合法时，按上面第 2 条回到 `open` |
| 页面里的新题号 | `since` 为本版，`open` |
| 上一版来自页面、本版页面里没有了的题，现在是 `open` | 记为被本版取代（`{kind: "superseded", in: N, by: null}`），输出 `dropped[]` 并给 `questions_dropped` 警告；`--keep <题号>` 可以原样保留（暂时删掉的题不被误伤） |
| 同上，但已经答过（`answered`） | 保留，`page` 记 `null`，不警告：审查报告进入下一轮时删掉已处理的条目是常态 |
| 已撤回或已取代的题号又出现在页面里 | 保持原结局、不复活，给 `retired_question_in_page` 警告：题意变了就换题号；例外见下一行 |
| 产物已关闭、这次发布把它重新打开 | 因关闭而撤回（`reason: "closed"`）、且页面里还在的题恢复成活的；其余结局不变 |
| 页面里的题号与 `nbdev ask` 登记的题同号 | `duplicate_question`，发布失败 |
| `ask` 登记的题 | 重新发布页面时原样带过去，不按“页面里没有”处理 |

- **关闭**：`artifact close` 写一版 `state: "closed"`，把 `open` 的题记成 `{kind: "withdrawn", in: N, reason: "closed"}`；已答的题不动。
- 场景 2（换题号）：旧题号 `superseded`，它的旧答复照常列出并标“针对 v1”；新题号 `open`；收件箱不算被取代的题。
- 开发者对着旧版本提交的答复（t10）照收：写入时按答复针对的那一版校验；读状态时仍按最新一版判断（第 2 条）。

### 挂在 Task 上的提问集

`nbdev ask <workRef> <taskRef> …` 不加 `--artifact` 时，题记进这个 Task 的 `artifacts/questions/`：每次登记生成新的一版（`action: "ask"`），答复、确认、收件箱与其它产物同一套逻辑。`--about <路径>` 记在题上，注明这道题针对哪份文档类产物，也可以指向 Spec：只校验它是仓库根相对的路径（不以 `/` 开头、不含 `..`）；主工作区与调用者所在的 checkout 里都找不到这个文件时给 `about_not_found` 警告，不拒绝（Spec 草稿常在实现分支上）。

### 答复与确认

- **答复**（`nbdev.answer/v1`）：`workId`、`taskId`、`artifactId`、`answerId`、`artifactVersion`、`contentHash`、`submittedAt`、`submittedBy`、`values`（`{题号: 值}`，只含这次填的题）、`comments`（可选，`{题号: 文字}`，例如审查条目选“要讨论”时逐条写理由）、`note`。`submittedBy` 是 `{kind: "developer", device}`（t10 的面板）或 `{kind: "agent-transcribed"}`（`answers record`），不带会话。改答案就再写一份，旧的不删。
- **取值校验**：`single` 是选项值；`multi` 是不重复的选项值数组，至少一个；`text` 是非空字符串，最长 10000 字；`confirm` 是布尔值。写入时按答复针对的那一版校验，不合法就拒绝（`invalid_answer`，退出码 2）；只能答活的题（`question_closed`，退出码 3）。读取时不合法的（手改的文件、选项后来改了）照常列出，标 `invalid_value` 或 `stale_value`。
- **确认**（`nbdev.answer-ack/v1`）：`ackId`、`answers`（这次确认覆盖的答复 id：当时还未确认的全部）、`through`（其中最大的 id，只用于显示）、`included`（同一个提交里的其它路径）、`ackedAt`。在锁内算，所以并发的答复不会被算进去又没被看到。没有未确认的答复时不写文件，给 `already_acked` 警告，`--include` 的文件也不提交（警告里写明）。
- **“有新答复”**：`answersAfter(answers, cursor)` 返回 id 大于游标的答复，`unackedAnswers(answers, acks)` 返回集合差。`--unacked` 用后者；`--wait --since` 与 t11 的通知游标用前者（id 在锁内单调生成，游标可靠）。

### 提问者与写入者：运行时的 provenance

`askedBy` 不入库。每次 nbdev 写出一个发布记录、代录答复或确认，都在 `.local/agent/run/provenance/` 下按与入库文件相同的相对路径记一份（`nbdev.provenance/v1`）：`path`（入库文件的路径）、`sha256`（入库文件的内容哈希）、`action`、`leaseId`、`session`（租约里的会话快照）、`recordedAt`。调用者未知或租约没取到时不写。这份文件在写事务落位之后写，失败只给 `provenance_write_failed` 警告。

- 发布、`ask`、`answers record`、`answers ack` 都先续期调用者在这个 Task 上的租约（t07 的 `touchCallerLease`），再写 provenance，所以 `leaseId` 就是本次续期的那份。
- `askerOf(mainRoot, ref, questionId)`：取题的 `since` 那一版的 provenance，核对 `sha256` 与磁盘上的发布记录一致（发布记录被删后重建时，旧的 provenance 不会冒认），一致才返回 `{leaseId, session}`，否则 `null`。
- 发布的输出里写明上一版是谁发布的（读上一版的 provenance）；读不到就不写。

### 最近更新

发布、答复、确认都**不改** Task README 的 `updated`：改了就要把会话正在改的 README 一起提交，与场景 9 冲突。`status` 的 Task 视图里，“最近更新”取 frontmatter 的 `updated` 与产物目录（`artifacts/`）最后一次提交的日期中较晚的那个；来自提交日期时 `origin` 是 `commit`。`readCommitDates` 顺带记下每个 Task 的 `artifacts/` 的日期。写进 `docs/file-formats.md` 的“记录的读法”。

### 图片体积检查

发布时检查，只警告、不阻止：

- 单张：产物目录里的图片（`png`、`jpg`、`jpeg`、`gif`、`webp`、`avif`、`bmp`、`svg`）超过 300 KiB，给 `image_too_large`（列出文件与大小）。
- 每个 Task 合计：Task 目录下 `artifacts/` 与 `evidences/` 里 Git 会跟踪的图片，用 `git ls-files -z --cached --others --exclude-standard` 列出（含本次要提交的新图），超过 5 MiB 给 `task_images_too_large`。
- 警告里提示“转成 WebP 或缩小，原图留在 `.local/agent/works/<workId>/tasks/<taskId>/shots/`”。

### 文档类产物的索引

读取时现算，不写任何文件：Task 目录第一层除 `README.md` 外的 `.md`，每份给 `{path, title}`，`title` 取第一行 `# ` 标题；Work 目录第一层同样处理。来源跟着记录走：来自分支的 Work 从它的执行 worktree 读。只读第一层，不递归 `evidences/`。`file-formats.md` 里“不递归 `artifacts/`”那句改成：产物只读 `artifacts/<id>/` 下的 `versions/` 与 `answers/` 两层，不读页面文件。

### 写入的公共前置

发布、关闭、登记、撤回、取代、代录、确认都要求：

- Work README 已提交到 `master`（沿用 `work_not_committed`），Task README 也已提交（新增 `task_not_committed`）。不然 `master` 上会出现没有 Task README 的产物提交。
- **Task 的来源必须是 `master`**，判定与 `setRecordStatus` 相同：来自分支的 Work 里，只在 `master` 上的 Task（例如 t80）或经 nbdev 领号的 Task 可以写；还在分支上维护的报 `branch_maintained_record`。这段从 `setRecordStatus` 抽成 `resolveWritableTask` 共用。
- **全部在写事务的锁内算**：读上一版、列页面文件、解析页面、算 `contentHash`、`nextQuestions`、生成答复与确认的 id、算确认覆盖的答复。在锁外算的话，两个发布同时进行时，后拿到锁的一方会写出内容更旧的版本。
- 发布时提交的路径：新的 `versions/v<N>.json`，加上产物目录里 Git 有变化的文件（`git status --porcelain -z -uall --no-renames`，去掉 `versions/`、`answers/` 与删除项），经 `includePaths` 一起提交。页面里删掉的文件不能经写事务提交，给 `artifact_deletions_not_committed` 警告并列出路径。`--force-version` 时，另把 `versions/` 下还没提交的发布记录（上一次提交失败留下的）一起提交。
- `--include` 的路径相对主工作区根，只接受 `.agents/works/` 下的路径（t06 的 `normalizeRecordPath`）。
- 发布到已关闭的产物会重新打开它（`artifact_reopened` 警告）；`ask --artifact` 指向已关闭的产物报 `artifact_closed`。
- Task 已是 `done` 或 `shelved` 时照常写入（例如收尾报告）；`task status … done` 遇到这个 Task 还有 `open` 的必答题时给 `open_questions` 警告，不自动撤回。

### 核心接口

新增模块，全部经 `src/index.ts` 导出：

| 模块 | 内容 |
|---|---|
| `src/core/questions.ts` | 类型；`parseQuestionMarkup(html, page)`（按需导入 parse5）→ `{questions, references, problems, scriptMarkers}`；`validateAnswerValue`；`REVIEW_OPTIONS` |
| `src/core/artifacts.ts` | 文件格式的读写与校验（认不出的 `schema` 主版本报 `schema_unsupported`，读列表时只给警告）；`listArtifacts`、`readArtifact(…, {version?})`；纯函数 `nextQuestions`、`questionStates`、`answersAfter`、`unackedAnswers`、`adoptionOf`、`nextRecordId`；`artifactContentHash`；`listDocuments` |
| `src/core/provenance.ts` | `writeProvenance`、`readProvenance`、`askerOf` |
| `src/core/artifact-ops.ts` | 写入：`publishArtifact`、`closeArtifact`、`askQuestions`、`withdrawQuestion`、`supersedeQuestion`、`submitAnswer`（`answers record` 与 t10 共用，`submittedBy` 由调用方给）、`ackAnswers`；读取：`readAnswers`；等待：`waitForAnswers(…, {timeoutMs, pollMs, signal})`；图片检查 |

### 命令合同

`--json` 外壳、退出码与写什么的规则沿用 t06。

| 命令 | 参数 | `schema` |
|---|---|---|
| `artifact publish <workRef> <taskRef> <artifactId>` | `--kind`（第一次必填）、`--title`、`--entry`（缺省 `index.html`）、`--keep <题号>`（可重复）、`--force-version`、`--as` | `nbdev.artifact-publish/v1` |
| `artifact close <workRef> <taskRef> <artifactId>` | `--as` | `nbdev.artifact-close/v1` |
| `ask <workRef> <taskRef>` | `--id`、`--type`、`--label`，`--option <值>[=<名称>]`（可重复，或 `@review`），`--optional`、`--recommend <值>`、`--artifact <artifactId>`、`--about <路径>`；或 `--from <JSON 文件>` 一次登记多道（不与单题参数混用）；`--as` | `nbdev.ask/v1` |
| `ask withdraw <workRef> <taskRef> <提问>` | `--as` | `nbdev.ask-withdraw/v1` |
| `ask supersede <workRef> <taskRef> <提问> --by <提问>` | `--as` | `nbdev.ask-supersede/v1` |
| `answers [<workRef> [<taskRef> [<artifactId>]]]` | `--pending` 或 `--unacked`；`--wait`、`--timeout <秒>`、`--since <答复 id>`（`--wait` 不与 `--pending` 同用）；`--as` | `nbdev.answers/v1` |
| `answers ack <workRef> <taskRef> <artifactId>` | `--include <路径>`（可重复）、`--as` | `nbdev.answers-ack/v1` |
| `answers record <workRef> <taskRef> <artifactId>` | `--set <题号>=<值>`（可重复；`multi` 用逗号分隔，`confirm` 写 `yes` 或 `no`）、`--comment <题号>=<文字>`（可重复）、`--note`、`--as` | `nbdev.answers-record/v1` |

- `<提问>` 写 `<artifactId>#<题号>`，Task 提问集里的题可以只写题号；`--by` 另可写 `<workRef>/<taskRef>/<artifactId>#<题号>` 指向别的 Task。
- `answers` 是只读命令（除了续期租约）；指定了 Task 时续期调用者在这个 Task 上的租约。`data.artifacts[]` 给出每个产物的最新版本、题与状态、答复、确认、`unacked[]`、采纳状态，以及 `cursor`（当前最大的答复 id）。`--pending` 只列有 `open` 必答题的产物，题也只列这些；`--unacked` 只列有未确认答复的产物。
- 命令行的参数解析加上“位置参数个数在一个范围内”（`answers` 的 0 到 3 个）。
- **提交失败后的补救**（写进 `cli.md`）：命令报 `commit_failed`，`data.commit.writtenPaths` 列出已写的文件。推荐手动提交这些路径（`git commit -- <路径>`）；也可以加 `--force-version` 重跑发布：内容没变也出新的一版，并把还没提交的发布记录一起提交。不加时重跑会被判成 `unchanged`，文件始终不会提交。
- 新错误码：`invalid_artifact_id`、`invalid_questions`、`invalid_answer`（2）；`duplicate_question`、`artifact_closed`、`question_closed`、`task_not_committed`（3）；`wait_timeout`、`wait_interrupted`（4）；`artifact_not_found`、`question_not_found`、`entry_missing`、`no_answers`（5）。`ExitCode` 加上 4。
- 提交消息：`docs(w00022): t03 发布 review v2`、`… 关闭 review（v3）`、`… 登记提问 migrate-order`、`… 撤回提问 review#home-order`、`… 代录 review 的答复`、`… 确认采纳 review 的答复`。

### `--wait`

- 等到“选中的答复”不为空就退出（退出码 0），输出与不带 `--wait` 时相同。缺省按 `--unacked` 选，所以已有未确认的答复时立即返回：会话发布之后、挂上等待之前到达的答复不会被漏掉。只想等之后的新答复时用 `--since <cursor>`。
- **轮询范围**：开始时完整读一次（含过渡期判定），定下范围内的产物；之后每秒只 `readdir` 主工作区里这些产物的 `answers/`（答复只写在 `master` 上），不跑 Git、不做过渡期判定。目录里出现新文件才重读这个产物的答复；读到 `artifactVersion` 大于已知最新版的答复时，重读一次发布记录。范围在开始时定下，等待期间新发布的产物不在内。
- `--timeout` 缺省 1800 秒，到点退出码 4（`wait_timeout`）；收到 SIGTERM 或 SIGINT 时停止轮询，输出 `wait_interrupted`，退出码同样是 4。
- **重挂办法**（文档分开写）：退出码 4（或被宿主结束）时按原参数重挂；退出码 0 时先处理并 `answers ack`，或带 `--since <cursor>` 重挂，否则按原参数重挂会立刻返回，会话被反复叫醒。
- **受 Claude Code 后台任务存活上限的约束**：会话用 `run_in_background` 挂着，命令一退出会话就被唤醒；宿主若在上限处结束它，会话看到的也是“退出”，照样重挂即可，不会丢答复。单个后台任务的上限没有核实，所以缺省超时取 30 分钟。
- 开始与结束时各续期一次调用者的租约（指定了 Task 时）。

### `status` 的收件箱

- `data.inbox[]`：只放要开发者动手的事（Proposal 第三节）。一类是 `open` 的必答题，含审查条目：`{kind: "question", workId, taskId, artifactId, questionId, label, type, version, since, askedBy}`，其中 `askedBy` 是运行时的会话键，由 `askerOf` 得到，读不到为 `null`。另一类是编号冲突：`{kind: "number_conflict", label, live}`。带 `--work`、`--task` 时只列范围内的。
- `TaskView` 加 `artifacts[]`（每个产物的 `artifactId`、`kind`、`title`、`version`、`state`、`publishedAt`、`openRequired`、采纳状态；没有发布记录的显示为 `unpublished`）与 `documents[]`；`WorkView` 加 `documents[]` 与 `artifacts[]`（Work 级产物，只索引）。Task 的 `updated` 按“最近更新”一节算。
- 人读输出在开头列“收件箱：N 道待答”，逐行列出题号与题目。
- 只读不变：不取锁、不写文件，不加载 parse5。新增的读取实测 4.5 到 17.7 毫秒（审查），S6 复测。

### design-review 的改动

改 [`.agents/skills/design-review/SKILL.md`](../../../../skills/design-review/SKILL.md) 的“评审板”与“评审板怎么写”两处，随命令行同一次合入：

- 每个待定的问题在页面上用提问标记写成一道题（链接到包内的格式文档与例子页）；标题里的徽标加 `data-nbdev-skip`；扁平的板（标题后跟兄弟元素）先给每道题包一层 `section`。
- 每轮写好后用 `nbdev artifact publish <workId> <taskId> review --kind design` 发布，`versions/`、`answers/` 只由 nbdev 写。被后一轮取代的问题换题号或从页面删掉，发布输出会列出 `dropped`。
- 读答复用 `nbdev answers <workId> <taskId> review --json`；把决定按编号写进 Task README 后，用 `nbdev answers ack <workId> <taskId> review --include <Task README>` 一起提交。开发者在会话里口头定的，用 `answers record` 代录。
- 页面上的“待定”“已定”徽标只给人看，结局以发布记录为准。
- **过渡条款**：nbdev 不可用、或还没获授权在真实仓库使用时，按旧做法：直接写产物目录，路径限定提交。

### 给 t09 到 t11 的备注

- t09 的只读视图直接用 `listArtifacts`、`readArtifact`、`questionStates`、`listDocuments`；`contentHash` 与磁盘不一致（发布后被改过）用 `artifactContentHash` 现算，`status` 不算（要读全部文件）。
- t10 的答复用 `submitAnswer`，`submittedBy` 填 `{kind: "developer", device}`，`artifactVersion` 填开发者打开的版本（`readArtifact(…, {version})`），`comments` 逐题填。
- t11 用 `answersAfter` 与 `askerOf`；游标存在它自己的 `run/notify/` 里。`askerOf` 返回 `null`（别的机器上、删过 `.local`、发布记录被重建）时，降级为“列出其它持有这个 Task 租约的会话”。Task 已是 `done` 时，提问者的租约会被现算成 `task_closed`，按租约找人的通知不会发给它。

## 文档改动

| 文件 | 内容 |
|---|---|
| `packages/dev-panel/docs/cli.md` | 八个命令的参数、写什么、`--wait` 的语义与重挂办法、提交失败后的补救、新错误码与警告、退出码 4 |
| `packages/dev-panel/docs/file-formats.md` | 产物目录、发布记录与结局、提问标记、答复（含 `comments`）、确认、provenance、`contentHash` 的算法、答复 id 的生成、状态现算（按最新一版校验）、“最近更新”的取法、“不递归 `artifacts/`”一句改写 |
| `packages/dev-panel/docs/examples/questions.html` | 例子页（L1 测试会解析它） |
| `packages/dev-panel/CONTEXT.md` | 新词：发布记录、提问集、代录、确认、等会话采纳与已采纳、收件箱；不变量 1 补一句：答复与确认里也没有会话 |
| `packages/dev-panel/AGENTS.md` | 测试只在临时仓库发布；`parse5` 是核心的依赖，只在发布路径按需导入 |
| `.local/README.md` | Agent 区加 `run/provenance/` |
| `.agents/skills/design-review/SKILL.md` | 见上节 |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test` 与 `typecheck`（检查退出码时把输出写到文件，不接 `&& tail`）。

| 切片 | 内容 | 提交 |
|---|---|---|
| S1 | `parse5` 依赖（`package.json` 与 `bun.lock`）；`questions.ts`；例子页；L1 标记解析（例子页、t03 评审板拷贝、各类错误与行号、`question_not_closed`、自动闭合提示、`questions_in_script`、引用检查） | `feat(dev-panel): 提问标记解析（w00022 t08）` |
| S2 | `artifacts.ts`、`provenance.ts`：格式、读取、`nextQuestions`、`questionStates`、`answersAfter`、`unackedAnswers`、`adoptionOf`、`nextRecordId`、`artifactContentHash`、`listDocuments`；L1 状态与结局推导（含关闭与重新打开、按最新一版校验、已答的题从页面消失），L2 文件读写、只追加、认不出的 schema、provenance 的哈希核对 | `feat(dev-panel): 产物、答复与确认的读取与现算（w00022 t08）` |
| S3 | `artifact-ops.ts`、`resolveWritableTask`、图片检查、新错误码；L2 在临时仓库里走写事务：发布、关闭与重新打开、登记、撤回、取代、代录、确认，提交只含预期路径，两个进程并发发布，“先读时钟、后拿锁”的交错，来自分支的 Work 里只在 master 上的 Task 可以发布 | `feat(dev-panel): 发布、提问、代录与确认的写入（w00022 t08）` |
| S4 | 命令行八个命令、位置参数范围、`--wait` 与信号处理；`status` 的收件箱、产物与文档索引、最近更新；L3 场景测试 | `feat(dev-panel): 产物与答复的命令、--wait 与收件箱（w00022 t08）` |
| S5 | 包文档、CONTEXT、AGENTS、`.local/README.md`；design-review；根一致性测试加一例：发布、登记、代录、确认之后 `verifyWorkContracts` 仍然通过 | 包文档与测试一个提交，Skill 单独一个提交 |
| S6 | 真实仓库只读运行 `status --json`，核对文档索引、收件箱与耗时；给主 Agent 准备“空闲会话被 `--wait` 唤醒”的验证命令（临时仓库、延时写答复的脚本），唤醒验证由主 Agent 在主会话里做 | 不提交 |

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 1 给评审板加两道题后发布：生成 `v1.json`，题号、类型、选项与页面一致，`askedBy` 是当前会话的租约 | L3：t03 评审板 `index.html` 的拷贝放在 `tests/fixtures/`，测试复制进临时仓库的 Task，在两个 `section` 上加标记后发布；断言 `v1.json` 的题与页面一致、没有任何会话字段；provenance 的 `leaseId` 等于调用者的租约（`--as` 一次，`startFakeClaude` 扮 Claude 一次），`askerOf` 能取回 |
| 2 改一道题的题号发布 v2：旧题号 `superseded`，旧答复标“针对 v1”，新题 `open`，收件箱不算被取代的题 | L1 `nextQuestions` 与 `questionStates`；L3 先用 `submitAnswer` 答 v1 的另一道题、留下要换号的题未答，再发布 v2，看 `answers` 与 `status --json` |
| 3 `ask` 登记一道题：提问集多一道 `open` 题，收件箱能看到；`ask withdraw` 之后消失 | L3 |
| 4 另一个进程挂 `answers … --wait --timeout 60`，写入答复并提交：几秒内退出并输出这份答复 | L3：子进程挂等待，测试进程调 `submitAnswer`；断言 5 秒内退出、退出码 0、输出含这份答复。另测 `--timeout 1` 得到退出码 4、SIGTERM 得到 `wait_interrupted`、已有未确认答复时立即返回、`--since` 只等新的、`--wait` 与 `--pending` 互斥。空闲会话被唤醒由主 Agent 在主会话里验证 |
| 5 `answers ack --include <Task README>`：确认文件与 README 在同一个提交里；`--unacked` 不再返回 | L3：断言提交的路径恰好是确认文件与 README |
| 6 引用一张 800 KB 的 PNG：发布成功但有体积警告 | L3（图片用随机字节生成，只看大小）；另测 Task 合计超过 5 MiB 的警告（含本次新加、未跟踪的图） |
| 7 两个进程同时发布同一个产物：版本号不重复 | L2：两个子进程用不同的 `--title` 同时发布，得到 v1 与 v2，各自的提交都在 |
| 8 `status --json` 列出 t01 与 t03 目录里的 Markdown，作为文档类产物 | L3（临时仓库里建这两个 Task 与几份 Markdown）；S6 在真实仓库只读核对 |
| 9 提问与答复的提交只含产物目录与 `--include` 列出的路径 | L2 每种写入各核对一次 `git diff-tree`；主工作区里放一个无关的已暂存改动，提交后它仍在暂存区 |

另有：L1 标记的每种错误都带行号；L1 关闭后重新打开只恢复因关闭而撤回、页面里还在的题，L3 同一流程走命令行；L2 “先读时钟、后拿锁”的交错下答复与确认的 id 仍单调，未确认按集合差算不漏；L2 认不出的 `schema` 主版本、手改坏的答复只给警告；L2 来自分支的 Work 里只在 master 上的 Task 可以发布；L3 `ask --artifact` 指向关闭的产物报 `artifact_closed`；L3 内容未变的重复发布不出新版本，`--force-version` 出新版本；L3 `status` 仍不写任何文件、不加载 parse5。

## 验证

- `bun run --cwd packages/dev-panel test`（含 L4）、`typecheck`。
- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`。
- `bun run governance:check`、`bun run docs:check`（包文档与 design-review）、`git diff --check`。
- S6：真实仓库只读，不发布、不答复、不确认；唤醒验证由主 Agent 做。
- **未验证的边界**：
  - Claude Code 单个后台任务能活多久；
  - 真实仓库里的第一次发布（要开发者授权）；
  - 面板对着旧版本答复（t10）与通知找提问者（t11），本片只提供接口与 L1、L2；
  - 能解析、但结构不如预期的标记（例如选项名取错了元素），只能靠输出逐题列出来让人看出。

## 不做与风险

- **不做**：面板（t09、t10）；通知（t11）；Work 级产物的发布命令；页面删除文件的提交；产物页里的 Vue 组件（决定 6）。
- **风险**：
  - **按“页面里没有”取代会误伤暂时删掉的题**：只取代还没答的题，输出列 `dropped` 并给警告，`--keep` 可以保留；被取代的题不复活，只能换题号。
  - **标记写错没被发现**：缺题目、缺选项、选项在题外、范围没有结束标签、选项名过长都直接报错；写在脚本里的给警告；其余靠输出逐题列出。
  - **主工作区里产物目录有别人的改动**：发布会把目录里所有有变化的文件一起提交，评审板通常只有一个会话在写，输出列出提交了哪些文件。
  - **轮询读到写到一半的答复**：答复由写事务独占创建（先写临时文件，再 link 到位），读的一方只会看到完整的文件。
  - **`--wait` 被宿主结束**：会话看到的就是退出，按原参数重挂；缺省按未确认选答复，不会漏。
  - **`status` 耗时**：现在约 0.87 秒，新增读取实测不到 20 毫秒，S6 复测；parse5 不在 `status` 里加载。

## 需要主 Agent 或开发者决定的点

第一轮的 5 个决定点已全部按推荐定下：答复与确认不记会话；`--wait` 缺省 30 分钟；被取代或撤回的题号不复活（关闭后重新打开的例外见上）；Task 关闭时只警告；design-review 与命令行同一次合入，Skill 加过渡条款。新增依赖 `parse5` 已在 lockfile 里，属于本地可逆操作，按 P-005 不另外询问。

## 与 Proposal、实施计划的不一致

1. **`askedBy` 不入库**，答复的 `submittedBy` 与确认也不记会话：已记入待确认清单。
2. **`contentHash` 覆盖整个产物目录**，不是“入口与它引用的本地文件”：子页经链接与 iframe 引用，逐个追引用容易漏。
3. **提问标记的前缀是 `data-nbdev-*`，并比 Proposal 多几个属性**：`label`、`optional`、`recommend`、`skip`、`options` 的一行写法与 `@review`；题可以写在产物里任何一个 `.html` 页上。Proposal 写的是 `data-nb-*`，只列了题号、类型与选项标记。前缀已记入待确认清单。
4. **Task 提问集的 `kind` 是 `questions`**，产物 id `questions` 保留：Proposal 的种类只有 `design`、`report`、`review`。
5. **发布记录多了 `action`、`origin`、`since`，撤回多了 `reason`**；`supersedes` 记上一版的版本号。内容与题都没变时不出新版本。
6. **`--wait` 缺省按未确认的答复返回**（已有未确认的答复时立即退出），另加 `--since`；Proposal 只写“等到有新答复才退出”。被信号打断也用退出码 4。
7. **入口可以是 Markdown**：t80 已有 Markdown 的 omp 审查报告，题用 `ask --artifact` 登记。Proposal 第三节默认入口是 `index.html`。
8. **Work 级产物本片只索引、不能发布**：Proposal 写“少数属于 Work 的，放在 Work 目录下同名的 `artifacts/`”，但命令都以 Task 为单位。
9. **写入要求 Task README 已提交**（`task_not_committed`）：Proposal 没写，与 t06 的 `work_not_committed` 同理。
10. **发布、答复、确认不改 `updated`**：Proposal 第二节写“写入某个 Task 的文件时同时改 `updated`”；改为“最近更新”取 `updated` 与产物目录提交日期中较晚的那个。
11. **答复多了可选的 `comments`**，确认的“到哪一份”改成覆盖的答复集合（`answers`），`through` 只用于显示。

## 设计审查的处理

审查报告见 [`evidences/design-review.txt`](evidences/design-review.txt)（opus 子代理，0 阻断、7 重要、13 建议），主 Agent 核实后 20 条全部采纳，有选择的几条按主 Agent 的决定。

| 审查条目 | 处理 | 改在哪里 |
|---|---|---|
| 1 答复 id 用取锁前的时间，按 `through` 判断会漏 | id 在锁内重新读时钟、单调生成；`submittedAt` 另记；未确认按集合差算，`through` 只用于显示；补“先读时钟、后拿锁”的交错用例 | 目录与文件；答复与确认；S3、验收映射 |
| 2 关闭与重新打开没定 | 关闭把 `open` 的题记成 `withdrawn`、`reason: "closed"`；重新打开只恢复因关闭而撤回、页面里还在的题；补 L1、L3 | 结局与状态现算 |
| 3 `answered` 按哪一版校验 | 按最新一版；不合法回到 `open`，列出旧答复并标 `stale_value`；写进 `file-formats.md` | 结局与状态现算；文档改动 |
| 4 改不改 `updated` | 都不改 README；“最近更新”取 `updated` 与产物目录提交日期中较晚的那个；写进文档 | 最近更新；不一致第 10 条 |
| 5 写入前置会拒掉 t80 | 改成“Task 的来源必须是 master”，与 `setRecordStatus` 相同；补 L2 | 写入的公共前置；S3 |
| 6 `--pending` 没定义 | 列有 `open` 必答题的产物与题，与 `--wait` 互斥 | 命令合同 |
| 7 S6 证明不了唤醒 | 唤醒验证由主 Agent 在主会话里做；本片给出可直接运行的命令 | 切片 S6；验收映射场景 4 |
| 8 题目与选项名的取法 | 选项名按 `data-nbdev-label`、第一个标题、自身文字的顺序取，超过 80 字报错；取文字时跳过 `data-nbdev-skip`；Skill 写明扁平板先包 `section` | 提问标记；design-review |
| 9 漏写闭合标签 | `question_not_closed` 带行号；题外选项的报错提示 HTML 自动闭合 | 提问标记 |
| 10 写在脚本里的标记被忽略 | `.js` 文件或内联 `<script>` 里出现标记给 `questions_in_script` | 提问标记 |
| 11 已答的题被记成取代 | 页面里消失时只取代 `open` 的题；已答的保留 `answered`，`page` 记 `null`，不警告 | 新版本怎么生成题表 |
| 12 解析与哈希要在锁内 | 读上一版、列文件、解析、哈希、`nextQuestions`、生成 id 都在锁内 | 写入的公共前置 |
| 13 非发布动作的字段、`title` 缺省、补救办法 | 非发布动作沿用 `contentHash`、`entry`、`title`，不重新解析；`title` 缺省沿用上一版；`cli.md` 写补救办法，加 `--force-version` | 发布记录；命令合同 |
| 14 Git 参数 | 图片合计用 `ls-files -z --cached --others --exclude-standard`；页面改动加 `-z --no-renames`；`contentHash` 路径相对产物目录、按 UTF-8 字节序、遇符号链接拒绝 | 发布记录；图片体积检查；写入的公共前置 |
| 15 provenance 的隐患与给 t11 的备注 | provenance 记入库文件的 sha256，`askerOf` 核对；`askerOf` 为 `null` 时 t11 降级；Task 已 `done` 时提问者租约为 `task_closed` | provenance；给 t09 到 t11 的备注 |
| 16 给 t09、t10 的字段 | `TaskView.artifacts[]` 加 `publishedAt`；`WorkView` 加 `artifacts[]`；取代者存规范化的完整 id；`readArtifact` 能读指定版本；答复加 `comments`；改掉“不递归 `artifacts/`”一句 | 发布记录；答复与确认；`status` 的收件箱；文档类产物的索引 |
| 17 `--wait` 的轮询范围与重挂 | 每秒只读主工作区里这些产物的 `answers/`，不跑 Git、不做过渡期判定；重挂办法按退出码分开写；读到更新的版本时重读一次 | `--wait` |
| 18 `--about` 与 `--include` 的路径 | `--about` 只校验格式，两处都找不到只警告；`--include` 相对主工作区根、只收 `.agents/works/` 下 | 挂在 Task 上的提问集；写入的公共前置 |
| 19 `data-nb-*` 与 nb-ui 撞前缀 | 改用 `data-nbdev-*`（已记入待确认清单） | 提问标记 |
| 20 引用检查 | 先去掉 `#…`、`?…` 再判断；指向产物目录之外的给 `reference_outside_artifact` | HTML 解析器 |
| 另：parse5 的导入 | 只在发布路径按需导入，`status` 不加载 | HTML 解析器；`status` 的收件箱 |
| 另：Skill 过渡条款 | nbdev 不可用或未获授权在真实仓库使用时按旧做法 | design-review 的改动 |

## 实施中的偏差

集成分支提交 `cdcaf2cd5`（S1）、`bb7c85a70`（S2）、`4fb81f866`（S3）、`daac769ea`（S4）、`d592d293b`（S5 文档与根一致性测试）、`908e8e77f`（S5 design-review）、`f3257f02e`（补命令行的关闭与重新打开用例），未 push。

| 偏差 | 原因与处理 |
|---|---|
| 加 parse5 依赖后，`bun.lock` 里 `entities` 的提升变了：根目录从 7.0.1 换成 8.0.0（parse5 用），`@vue/compiler-core` 与 `happy-dom` 改为各自嵌套 7.0.1 | bun 自动重排的结果，各个使用方拿到的版本都没变；合入 master 后主工作区要 `bun install` 一次才会按新的提升布局重排（不装也能跑：根目录 `node_modules` 里已有 parse5） |
| `--wait` 开始轮询时在 stderr 报一行“等待中” | 计划没写。人能看出它在等；L3 测 SIGTERM 时据此判断它已进入等待，不用固定等待 |
| 命令行的共用小工具搬到 `src/cli/common.ts`，产物与答复的命令放在 `src/cli/artifact-commands.ts` | `main.ts` 已经很长；共用部分若留在 `main.ts`，两个文件会互相导入 |
| `answers record --set` 的取值换算放进核心（`submitAnswer` 的 `rawValues`） | 换算要按题的类型做，类型在锁内读到的那一版里；放在命令行边界就要多读一次 |
| provenance 的路径是入库文件相对 `.agents/works/` 的路径，不再加 `.json` 后缀 | 入库文件本来就是 `.json`；计划的目录树写成了 `<相对路径>.json` |
| `answers ack --include` 的路径在“没有未确认的答复”时也校验 | 计划只写了“不提交”；路径不合规时报错更早暴露写错的参数 |
| 引用检查也覆盖 `<a href>`：t03 评审板的拷贝发布时会报 `missing_reference`（子页没有拷进夹具） | 计划写的是 `src`、`href`、`srcset`、`poster`，`href` 本来就包括链接；真实的评审板子页都在，不会报 |
| 重复关闭给 `already_closed` 警告、不出新版本 | 计划没写这种情形 |

- **真实仓库只读 `status`**：880 到 889 毫秒（上一轮约 870）；`.local/agent` 与 `git status` 前后不变。文档类产物共 107 份，t01 列出 2 份、t03 列出 3 份；t03 与 t80 的评审板、t80 的 omp 审查报告都显示为 `unpublished`，不进收件箱；收件箱只有 2 处撞号（w00007、w00003 的 t05）。
- **唤醒验证**的临时仓库与脚本在会话临时目录 `t08/wake/` 下（`setup.sh` 已跑过，`dry-run.sh` 实测写答复后约 0.6 秒退出），命令见编码子代理的汇报；由主 Agent 在主会话里做。
