# t08 实施计划：产物、提问与答复（命令行）

草案，交主 Agent 与设计审查（编码子代理 2026-10-12 写）。范围以 [实施计划的 t08 一节](../t03-design/plan.md#t08-产物提问与答复命令行)（场景 1 到 9）为准，设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第三节、待决问题 4 到 7（开发者已按推荐同意），以及主 Agent 定的三条调整：`askedBy` 不入库、测试只在临时仓库发布、写入都走 t06 的写事务。

## Context

- **要解决的问题**：Agent 要开发者拍板的事现在只能在终端里问、在终端里答，记录里查不到；评审板的“要你定”没有机器可读的格式，被后一轮取代的问题仍写着待定，待答数虚高。t08 让 Agent 能把提问发布成记录、读到入库的答复、确认采纳，每道题都有结局；面板（t09、t10）与通知（t11）读写同一套文件。
- **已定的决定**：答复入库、只追加（决定 12）；Task 目录里的 Markdown 算文档类产物，按文件索引（待决问题 5）；挂在 Task 上的提问存成没有页面的产物（待决问题 6）；“已采纳”的确认入库，与写了决定的 Task README 同一个提交（待决问题 7）；`updated` 字段由 nbdev 写（待决问题 4，t06 已实现）；图片单张约 300 KB、每个 Task 约 5 MB（决定 13）；纯讲解页没有“已看”（决定 6）。
- **主 Agent 定的调整**：
  - `askedBy`（租约与会话快照）不写进入库的 `versions/vN.json`，放 `.local/agent/run/` 下、按产物版本对应；入库的发布记录里没有任何指向会话的字段。用 t07 导出的 `getLease`、`evaluateLease`。
  - 测试只在临时仓库里发布；不在真实仓库发布，也不改真实的 t03 评审板。场景 1 用评审板的一份拷贝做夹具。
  - 提问、答复与确认的写入都走 t06 的写事务；“有新答复”的判定要能给 t11 的通知复用。
- **前提**：t06、t07 已在集成分支（`3e086d8e1`）：写事务（`createFile` 独占创建、`includePaths`）、过渡期读法、`readProjectStatus`、调用者解析、`touchCallerLease`。
- **工作方式**：同 t07。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；记录只在主工作区改。
- **约束**：核心只用 Node 兼容 API（根脚本测试在 Node 下导入）；只支持 Linux。

## 环境核实（2026-10-12，本机只读）

| 事项 | 结论 | 怎么查的 |
|---|---|---|
| 可复用的 HTML 解析器 | `parse5@8.0.1` 已在 `bun.lock` 里（根依赖 `jsdom@29.1.1` 的依赖），唯一依赖 `entities@8`，ESM，支持 `sourceCodeLocationInfo`（报错能带行列）。解析 56 KB 的 t03 评审板，Node 25 毫秒、Bun 22 毫秒 | `bun.lock`；在 worktree 里用 Node 与 Bun 各跑一次探针（探针已删） |
| 其它候选 | `jsdom`（根依赖）与 `happy-dom@20.11`（nb-ui、llmlint 的开发依赖）是整套 DOM，太重；Bun 的 `HTMLRewriter` 只在 Bun 下有，核心要在 Node 下跑，不能用 | 各包 `package.json` |
| 已有产物 | `master` 上只有两个 Task 有 `artifacts/`：t03 的 `review/`（`index.html` 56 KB、`model.html`、`r1/` 到 `r3/` 的子页、`assets/` 的 JS 与 CSS、`build.ts`，没有图片，共约 560 KB）；w00017 t80 的 `review/`（20 多张 WebP，最大 165 KB）与 `omp-review-1/`（`report.md` 与 `brief.md`，即 Markdown 的审查报告）。都没有 `versions/` 与 `answers/` | `find .agents/works -path '*/artifacts/*'` |
| t03 评审板的写法 | 每个问题是一个 `section.q`，标题是 `<h2><span class="badge …">待定</span>首页……</h2>`：标题文字里带着“待定”“已定”“已取代”徽标。从标题取题目会把徽标带进去 | 读 `index.html` |
| Task 目录里的 Markdown | `master` 上 152 个 Task 目录里，README 之外的第一层 `.md` 共 27 个（需求分析、领域模型、调研、计划） | `find .agents/works -mindepth 4 -maxdepth 4 -name '*.md'` |
| 写事务的边界 | `createFile` 只写 UTF-8 文字（nbdev 只写 JSON，够用）；`includePaths` 要求路径在 `.agents/works/` 下且文件存在，所以已删除的文件不能一起提交；提交后核对提交里的路径与预期一致，不一致给 `commit_paths_mismatch` 警告 | `src/core/transaction.ts` |
| Claude Code 的后台任务 | `run_in_background` 起的命令退出时会唤醒会话；单个后台任务能活多久**没有核实**（开发者的全局记忆写过“存活上限低”，没有具体数字） | 本会话的工具说明；全局记忆 |

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
    │       └── ack-<答复 id 格式>.json      # 确认
    └── questions/                         # Task 的提问集：没有页面的产物，保留名
        ├── versions/v<N>.json
        └── answers/…

.local/agent/run/provenance/<workId>/tasks/<taskId>/artifacts/<artifactId>/
    ├── versions/v<N>.json                  # 这一版由哪个会话写的（askedBy）
    └── answers/<文件名>                     # 代录与确认由哪个会话写的（见决定点 1）
```

- `artifactId` 用 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`，最长 48 个字符），在 Task 内唯一；`questions` 保留给 Task 的提问集。
- `versions/` 与 `answers/` 只由 nbdev（以后加上面板）写；会话只写页面文件。
- 答复 id 是 `<UTC 时间，精确到毫秒，形如 20261012T213012345Z>-<8 位 hex>`，按字典序就是时间顺序。确认文件名是 `ack-` 加同样格式的 id。
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
- **最新一版带全部题**：被取代、撤回的题也留在最新一版里，`outcome` 写明结局与发生在哪一版。读状态只看最新一版与答复，不用回放历史。
- `kind` 取 `design`、`report`、`review`；Task 提问集的 `kind` 是 `questions`，`entry` 与 `contentHash` 为 `null`。第一次发布必须给 `--kind`，之后缺省沿用上一版。
- `title` 取 `--title`，否则取入口页的 `<title>`，再否则用 `artifactId`。
- `contentHash`：产物目录里 Git 会跟踪的文件（`git ls-files --cached --others --exclude-standard`，去掉 `versions/`、`answers/`，只算磁盘上还在的），按路径排序后对“路径、NUL、文件 sha256、换行”逐行求 sha256。Proposal 写的是“入口与它引用的本地文件”；改成整个目录，因为评审板的子页是经 `<a>` 与 `<iframe>` 引用的，逐个追引用既复杂又容易漏，而整个目录本来就是一个产物。
- **内容与题都没变就不出新版本**：除 `version`、`supersedes`、`action`、`publishedAt` 之外与最新一版相同时，不写文件、不提交，输出 `unchanged: true`（照常续期租约）。
- 入口可以是 `.md`（例如 t80 的 omp 审查报告 `report.md`）：标记只从 `.html` 页里解析，这种产物的题用 `nbdev ask --artifact` 登记。

### 提问标记

写在产物目录里任意一个 `.html` 页上（不只入口页：题只写在子页上时也不会被漏掉），题号在整个产物内唯一。

| 写法 | 含义 |
|---|---|
| `data-nb-question="<题号>"` | 一道题的范围，放在包住这道题的元素上（通常是 `section`）。题号 `^[a-z0-9][a-z0-9-]{0,62}$`；题意变了就换题号 |
| `data-nb-type` | 必填：`single`、`multi`、`text`、`confirm` |
| 题目 | `data-nb-label="…"`；没有时取范围内第一个 `h1` 到 `h6` 的文字（空白折叠）。标题里有徽标等别的文字时必须写 `data-nb-label` |
| 选项 | 范围内带 `data-nb-option="<值>"` 的元素，文字（或它的 `data-nb-label`）是选项名；也可以在题上写一行 `data-nb-options="cards:A 卡片|table:B 表"`；`data-nb-options="@review"` 展开成“改（`fix`）、不改（`skip`）、要讨论（`discuss`）”，给审查报告的每条意见用 |
| `data-nb-optional` | 选答；缺省必答 |
| `data-nb-recommend="<值>[,<值>]"` | 推荐的选项（可选），面板与 `answers` 输出里标出 |

- `single`、`multi` 至少两个选项，选项值在题内唯一、用与题号相同的字符集；`text`、`confirm` 不能有选项。`confirm` 的答复是 `true` 或 `false`。
- 题不能嵌套；题外出现 `data-nb-option` 算错；页面里没有任何 `data-nb-question` 就是纯讲解页，不进收件箱。
- 解析出的每个问题都带页面与行号；任何一处不合规，发布整体失败（`invalid_questions`，退出码 2），`details.problems` 逐条给出页面、行列、题号与原因。成功时输出列出解析到的每道题（题号、类型、选项值），人读输出也逐行列出，写错的标记能当场看出来。
- **例子页** `packages/dev-panel/docs/examples/questions.html`：四种类型、`@review`、选答、推荐、`data-nb-label` 各一例；L1 测试解析这一页并断言结果，文档与解析器不会走样。片段：

```html
<section data-nb-question="home-layout" data-nb-type="single" data-nb-recommend="cards"
         data-nb-label="首页的 Work 区用卡片还是表">
  <h2><span class="badge warning">待定</span>首页（Work 视角）：A 卡片还是 B 表</h2>
  <div data-nb-option="cards">A 每个 Work 一张卡片</div>
  <div data-nb-option="table">B 一张表，按 Work 分组</div>
</section>
<li data-nb-question="review-3" data-nb-type="single" data-nb-options="@review">
  <h3>第 3 条：锁的接管没有核对持锁者</h3> …
</li>
<section data-nb-question="naming-note" data-nb-type="text" data-nb-optional><h2>命名有没有别的想法</h2></section>
<section data-nb-question="approve-spec" data-nb-type="confirm"><h2>批准把草稿晋升为 Spec</h2></section>
```

### HTML 解析器

用 `parse5`，在包的 `dependencies` 里声明 `^8.0.1`。它已在 lockfile 里（jsdom 的依赖），不新增下载；按规范解析，与浏览器看到的结构一致；能报行列；纯 JS，Node 与 Bun 都能跑。只遍历元素与属性、取文字，不执行脚本、不加载外部资源。

同一次遍历顺带收集页面引用的本地文件（`src`、`href`、`srcset`、`poster`；跳过带协议的地址、`#…`、`data:`）。目标不存在的给 `missing_reference` 警告；不据此决定 `contentHash` 的范围。

### 结局与状态现算

每道题的状态由最新一版与全部答复现算：

1. `outcome` 是撤回或取代：`withdrawn` 或 `superseded`（附取代者）。
2. 否则任何一份答复里有这道题的合法取值：`answered`。最新取值来自最新的答复，标出这份答复针对哪一版（“针对 v1”）。
3. 否则 `open`。

产物层面另算两项：`openRequired`（`open` 的必答题数）与采纳状态。最近一次确认之后还有答复的，算“等会话采纳”；最近一次确认覆盖了最新答复的，算“已采纳”；没有答复的不算这两种。

**新版本怎么生成题表**（纯函数 `nextQuestions`，L1 全覆盖）：

| 情形 | 处理 |
|---|---|
| 页面里的题号在上一版里是活的 | 沿用 `since`，题目、选项用新的定义；改了选项后旧答复的取值不再合法时，`answers` 输出里标 `stale_value` |
| 页面里的新题号 | `since` 为本版，`open` |
| 上一版来自页面、本版页面里没有了的活题 | 记为被本版取代（`{kind: "superseded", in: N, by: null}`），输出 `dropped[]` 并给 `questions_dropped` 警告；`--keep <题号>` 可以原样保留（暂时删掉的题不被误伤） |
| 已撤回或已取代的题号又出现在页面里 | 保持原结局、不复活，给 `retired_question_in_page` 警告：题意变了就换题号，复活会让旧答复看起来像在回答新题 |
| 页面里的题号与 `nbdev ask` 登记的题同号 | `duplicate_question`，发布失败 |
| `ask` 登记的题 | 重新发布页面时原样带过去，不按“页面里没有”处理 |

- 场景 2（换题号）：旧题号 `superseded`，它的旧答复照常列出并标“针对 v1”；新题号 `open`；收件箱不算被取代的题。
- 开发者对着旧版本提交的答复（t10）照收：答复记下 `artifactVersion`，取值按那一版的题目定义校验。

### 挂在 Task 上的提问集

`nbdev ask <workRef> <taskRef> …` 不加 `--artifact` 时，题记进这个 Task 的 `artifacts/questions/`：每次登记生成新的一版（`action: "ask"`），答复、确认、收件箱与其它产物同一套逻辑。`--about <路径>` 记在题上，路径相对仓库根，必须在主工作区里存在、不含 `..`；用来注明这道题针对哪份文档类产物，也可以指向 Spec。

### 答复与确认

- **答复**（`nbdev.answer/v1`）：`workId`、`taskId`、`artifactId`、`artifactVersion`、`contentHash`、`submittedAt`、`submittedBy`、`values`（`{题号: 值}`，只含这次填的题）、`note`。`submittedBy` 是 `{kind: "developer", device}`（t10 的面板）或 `{kind: "agent-transcribed"}`（`answers record`），不带会话（见决定点 1）。改答案就再写一份，旧的不删。
- **取值校验**：`single` 是选项值；`multi` 是不重复的选项值数组，至少一个；`text` 是非空字符串，最长 10000 字；`confirm` 是布尔值。写入时校验，不合法就拒绝（`invalid_answer`，退出码 2）；读取时校验失败的（手改的文件、选项后来改了）照常列出，标 `stale_value` 或 `invalid_value`。
- **确认**（`nbdev.answer-ack/v1`）：`through`（确认到的最新一份答复 id）、`answers`（这次确认覆盖的答复 id）、`included`（同一个提交里的其它路径）、`ackedAt`。没有新答复时不写文件，给 `already_acked` 警告，`--include` 的文件也不提交（警告里写明）。
- **“有新答复”**：`answersAfter(answers, cursor)` 返回 id 大于游标的答复。三处共用它：`answers --unacked` 的游标是最近一次确认的 `through`；`answers --wait --since` 的游标由调用方给；t11 的游标是最近一次成功通知。

### 提问者与写入者：运行时的 provenance

`askedBy` 不入库。每次 nbdev 写出一个发布记录、代录答复或确认，都在 `.local/agent/run/provenance/` 下按同样的相对路径记一份（`nbdev.provenance/v1`）：`path`（入库文件的路径）、`action`、`leaseId`、`session`（租约里的会话快照）、`recordedAt`。调用者未知或租约没取到时不写。这份文件在写事务提交之后写，失败只给 `provenance_write_failed` 警告。

- 发布、`ask`、`answers record`、`answers ack` 都先续期调用者在这个 Task 上的租约（t07 的 `touchCallerLease`），再写 provenance，所以 `leaseId` 就是本次续期的那份。
- t11 找提问者：题的 `since` 那一版的 provenance 给出 `leaseId`，再用 `getLease` 与 `evaluateLease` 判断租约是否还有效、能不能通知。导出 `askerOf(mainRoot, ref, questionId)`。
- 发布的输出里写明上一版是谁发布的（读上一版的 provenance）；读不到就不写。

### 图片体积检查

发布时检查，只警告、不阻止：

- 单张：产物目录里的图片（`png`、`jpg`、`jpeg`、`gif`、`webp`、`avif`、`bmp`、`svg`）超过 300 KiB，给 `image_too_large`（列出文件与大小）。
- 每个 Task 合计：Task 目录下 `artifacts/` 与 `evidences/` 里 Git 会跟踪的图片（一次 `git ls-files` 列出，不手工递归）超过 5 MiB，给 `task_images_too_large`。
- 警告里提示“转成 WebP 或缩小，原图留在 `.local/agent/works/<workId>/tasks/<taskId>/shots/`”。

### 文档类产物的索引

读取时现算，不写任何文件：Task 目录第一层除 `README.md` 外的 `.md`，每份给 `{path, title}`，`title` 取第一行 `# ` 标题；Work 目录第一层同样处理。来源跟着记录走：来自分支的 Work 从它的执行 worktree 读。只读第一层，不递归 `evidences/`。

### 写入的公共前置

发布、关闭、登记、撤回、取代、代录、确认都要求：

- Work README 已提交到 `master`（沿用 `work_not_committed`），Task README 也已提交（新增 `task_not_committed`）。不然 `master` 上会出现没有 Task README 的产物提交。
- Task 不在“还在分支上维护”的 Work 里，否则 `branch_maintained_record`。这部分从 `setRecordStatus` 抽成 `resolveWritableTask` 共用。
- 发布时提交的路径：新的 `versions/v<N>.json`，加上产物目录里 Git 有变化的文件（`git status --porcelain -uall`，去掉 `versions/`、`answers/` 与删除项），经 `includePaths` 一起提交。页面里删掉的文件不能经写事务提交，给 `artifact_deletions_not_committed` 警告并列出路径。
- 发布到已关闭的产物会重新打开它（`artifact_reopened` 警告）；`ask --artifact` 指向已关闭的产物报 `artifact_closed`。
- Task 已是 `done` 或 `shelved` 时照常写入（例如收尾报告）；`task status … done` 遇到这个 Task 还有 `open` 的必答题时给 `open_questions` 警告，不自动撤回。

### 核心接口

新增模块，全部经 `src/index.ts` 导出：

| 模块 | 内容 |
|---|---|
| `src/core/questions.ts` | 类型；`parseQuestionMarkup(html, page)` → `{questions, references, problems}`；`validateAnswerValue`；`REVIEW_OPTIONS` |
| `src/core/artifacts.ts` | 文件格式的读写与校验（认不出的 `schema` 主版本报 `schema_unsupported`，读列表时只给警告）；`listArtifacts`、`readArtifact`；纯函数 `nextQuestions`、`questionStates`、`answersAfter`、`adoptionOf`；`listDocuments` |
| `src/core/provenance.ts` | `writeProvenance`、`readProvenance`、`askerOf` |
| `src/core/artifact-ops.ts` | 写入：`publishArtifact`、`closeArtifact`、`askQuestions`、`withdrawQuestion`、`supersedeQuestion`、`submitAnswer`（`answers record` 与 t10 共用，`submittedBy` 由调用方给）、`ackAnswers`；等待：`waitForAnswers(…, {timeoutMs, pollMs, signal})`；图片检查 |

### 命令合同

`--json` 外壳、退出码与写什么的规则沿用 t06。

| 命令 | 参数 | `schema` |
|---|---|---|
| `artifact publish <workRef> <taskRef> <artifactId>` | `--kind`（第一次必填）、`--title`、`--entry`（缺省 `index.html`）、`--keep <题号>`（可重复）、`--as` | `nbdev.artifact-publish/v1` |
| `artifact close <workRef> <taskRef> <artifactId>` | `--as` | `nbdev.artifact-close/v1` |
| `ask <workRef> <taskRef>` | `--id`、`--type`、`--label`，`--option <值>[=<名称>]`（可重复，或 `@review`），`--optional`、`--recommend <值>`、`--artifact <artifactId>`、`--about <路径>`；或 `--from <JSON 文件>` 一次登记多道（不与单题参数混用）；`--as` | `nbdev.ask/v1` |
| `ask withdraw <workRef> <taskRef> <提问>` | `--as` | `nbdev.ask-withdraw/v1` |
| `ask supersede <workRef> <taskRef> <提问> --by <提问>` | `--as` | `nbdev.ask-supersede/v1` |
| `answers [<workRef> [<taskRef> [<artifactId>]]]` | `--pending` 或 `--unacked`；`--wait`、`--timeout <秒>`、`--since <答复 id>`；`--as` | `nbdev.answers/v1` |
| `answers ack <workRef> <taskRef> <artifactId>` | `--include <路径>`（可重复）、`--as` | `nbdev.answers-ack/v1` |
| `answers record <workRef> <taskRef> <artifactId>` | `--set <题号>=<值>`（可重复；`multi` 用逗号分隔，`confirm` 写 `yes` 或 `no`）、`--note`、`--as` | `nbdev.answers-record/v1` |

- `<提问>` 写 `<artifactId>#<题号>`，Task 提问集里的题可以只写题号；`--by` 另可写 `<workRef>/<taskRef>/<artifactId>#<题号>` 指向别的 Task。
- `answers` 是只读命令（除了续期租约）；指定了 Task 时续期调用者在这个 Task 上的租约。`data.artifacts[]` 给出每个产物的最新版本、题与状态、答复、确认、`unacked[]`、采纳状态，以及 `cursor`（当前最新的答复 id）。
- 命令行的参数解析加上“位置参数个数在一个范围内”（`answers` 的 0 到 3 个）。
- 新错误码：`invalid_artifact_id`、`invalid_questions`、`invalid_answer`（2）；`duplicate_question`、`artifact_closed`、`task_not_committed`（3）；`wait_timeout`、`wait_interrupted`（4）；`artifact_not_found`、`question_not_found`、`entry_missing`、`no_answers`（5）。`ExitCode` 加上 4。
- 提交消息：`docs(w00022): t03 发布 review v2`、`… 关闭 review（v3）`、`… 登记提问 migrate-order`、`… 撤回提问 review#home-order`、`… 代录 review 的答复`、`… 确认采纳 review 的答复`。

### `--wait`

- 等到“选中的答复”不为空就退出（退出码 0），输出与不带 `--wait` 时相同。缺省按 `--unacked` 选，所以已有未确认的答复时立即返回：会话发布之后、挂上等待之前到达的答复不会被漏掉。只想等之后的新答复时用 `--since <cursor>`，`cursor` 取上一次输出里的值。
- 实现是轮询：每秒读一次范围内各产物的 `answers/` 目录（只是 `readdir`），不取锁。不用 inotify，因为 `answers/` 在第一份答复之前可能还不存在，范围也可能跨很多产物。
- `--timeout` 缺省 1800 秒，到点退出码 4（`wait_timeout`）；收到 SIGTERM 或 SIGINT 时停止轮询，输出 `wait_interrupted`，退出码同样是 4。对调用方来说两者都表示“还没有答复，按原参数再挂一次”。
- **受 Claude Code 后台任务存活上限的约束**：会话用 `run_in_background` 挂着，命令一退出会话就被唤醒；宿主若在上限处结束它，会话看到的也是“退出”，照样重挂即可，不会丢答复（缺省的未确认语义加上 `--since`）。单个后台任务的上限没有核实，所以缺省超时取 30 分钟，文档里写明“退出码 4 或被宿主结束都按原参数重挂”。
- 开始与结束时各续期一次调用者的租约（指定了 Task 时）。

### `status` 的收件箱

- `data.inbox[]`：只放要开发者动手的事（Proposal 第三节）。一类是 `open` 的必答题，含审查条目：`{kind: "question", workId, taskId, artifactId, questionId, label, type, version, since, askedBy}`，其中 `askedBy` 是运行时的会话键，读 provenance 得到，读不到为 `null`。另一类是编号冲突：`{kind: "number_conflict", label, live}`。带 `--work`、`--task` 时只列范围内的。
- `TaskView` 加 `artifacts[]`（每个产物的 `artifactId`、`kind`、`title`、`version`、`state`、`openRequired`、采纳状态；没有发布记录的显示为 `unpublished`）与 `documents[]`；`WorkView` 加 `documents[]`。
- 人读输出在开头列“收件箱：N 道待答”，逐行列出题号与题目。
- 只读不变：不取锁、不写文件。新增的读取是每个 Task 一次 `readdir`，加上有 `artifacts/` 的 Task 再读最新一版、答复与确认的文件名，预计增加不到 30 毫秒，S6 实测。

### design-review 的改动

改 [`.agents/skills/design-review/SKILL.md`](../../../../skills/design-review/SKILL.md) 的“评审板”与“评审板怎么写”两处，随命令行同一次合入：

- 每个待定的问题在页面上用提问标记写成一道题（链接到包内的格式文档与例子页），标题里有徽标时写 `data-nb-label`。
- 每轮写好后用 `nbdev artifact publish <workId> <taskId> review --kind design` 发布，`versions/`、`answers/` 只由 nbdev 写。被后一轮取代的问题换题号或从页面删掉，发布输出会列出 `dropped`。
- 读答复用 `nbdev answers <workId> <taskId> review --json`；把决定按编号写进 Task README 后，用 `nbdev answers ack <workId> <taskId> review --include <Task README>` 一起提交。开发者在会话里口头定的，用 `answers record` 代录。
- 页面上的“待定”“已定”徽标只给人看，结局以发布记录为准。

### 给 t09 到 t11 的备注

- t09 的只读视图直接用 `listArtifacts`、`readArtifact`、`questionStates`、`listDocuments`；`contentHash` 与磁盘不一致（发布后被改过）由 `readArtifact` 的选项现算，`status` 不算（要读全部文件）。
- t10 的答复用 `submitAnswer`，`submittedBy` 填 `{kind: "developer", device}`，`artifactVersion` 填开发者打开的版本。
- t11 用 `answersAfter` 与 `askerOf`；游标存在它自己的 `run/notify/` 里。

## 文档改动

| 文件 | 内容 |
|---|---|
| `packages/dev-panel/docs/cli.md` | 八个命令的参数、写什么、`--wait` 的语义与重挂办法、新错误码与警告、退出码 4 |
| `packages/dev-panel/docs/file-formats.md` | 产物目录、发布记录、提问标记、答复、确认、provenance、`contentHash` 的算法、答复 id |
| `packages/dev-panel/docs/examples/questions.html` | 例子页（L1 测试会解析它） |
| `packages/dev-panel/CONTEXT.md` | 新词：发布记录、提问集、代录、确认、等会话采纳与已采纳、收件箱；不变量 1 补一句：答复与确认里也没有会话（按决定点 1） |
| `packages/dev-panel/AGENTS.md` | 测试只在临时仓库发布；`parse5` 是核心的依赖 |
| `.local/README.md` | Agent 区加 `run/provenance/` |
| `.agents/skills/design-review/SKILL.md` | 见上节 |

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test` 与 `typecheck`（检查退出码时把输出写到文件，不接 `&& tail`）。

| 切片 | 内容 | 提交 |
|---|---|---|
| S1 | `parse5` 依赖（`package.json` 与 `bun.lock`）；`questions.ts`；例子页；L1 标记解析（例子页、t03 评审板拷贝、各类错误与行号） | `feat(dev-panel): 提问标记解析（w00022 t08）` |
| S2 | `artifacts.ts`、`provenance.ts`：格式、读取、`nextQuestions`、`questionStates`、`answersAfter`、`adoptionOf`、`listDocuments`；L1 状态与结局推导，L2 文件读写、只追加、认不出的 schema | `feat(dev-panel): 产物、答复与确认的读取与现算（w00022 t08）` |
| S3 | `artifact-ops.ts`、`resolveWritableTask`、图片检查、新错误码；L2 在临时仓库里走写事务：发布、关闭、登记、撤回、取代、代录、确认，提交只含预期路径，两个进程并发发布 | `feat(dev-panel): 发布、提问、代录与确认的写入（w00022 t08）` |
| S4 | 命令行八个命令、位置参数范围、`--wait` 与信号处理；`status` 的收件箱、产物与文档索引；L3 场景测试 | `feat(dev-panel): 产物与答复的命令、--wait 与收件箱（w00022 t08）` |
| S5 | 包文档、CONTEXT、AGENTS、`.local/README.md`；design-review；根一致性测试加一例：发布、登记、代录、确认之后 `verifyWorkContracts` 仍然通过 | 包文档与测试一个提交，Skill 单独一个提交 |
| S6 | 真实宿主核对：在临时仓库里用本会话的 `run_in_background` 挂 `answers --wait`，另写一份答复，确认会话被唤醒并拿到答复；真实仓库只读运行 `status --json`，核对文档索引与耗时 | 不提交，结果交主 Agent 写进 Task README |

## 验收映射

| 场景 | 覆盖 |
|---|---|
| 1 给评审板加两道题后发布：生成 `v1.json`，题号、类型、选项与页面一致，`askedBy` 是当前会话的租约 | L3：t03 评审板 `index.html` 的拷贝放在 `tests/fixtures/`，测试复制进临时仓库的 Task，在两个 `section` 上加标记后发布；断言 `v1.json` 的题与页面一致、没有任何会话字段；provenance 的 `leaseId` 等于调用者（`--as`，另用环境干净的子进程扮 Claude 跑一次）的租约 |
| 2 改一道题的题号发布 v2：旧题号 `superseded`，旧答复标“针对 v1”，新题 `open`，收件箱不算被取代的题 | L1 `nextQuestions` 与 `questionStates`；L3 先用 `submitAnswer` 答 v1 的旧题，再发布 v2，看 `answers` 与 `status --json` |
| 3 `ask` 登记一道题：提问集多一道 `open` 题，收件箱能看到；`ask withdraw` 之后消失 | L3 |
| 4 另一个进程挂 `answers … --wait --timeout 60`，写入答复并提交：几秒内退出并输出这份答复 | L3：子进程挂等待，测试进程调 `submitAnswer`；断言 5 秒内退出、退出码 0、输出含这份答复。另测 `--timeout 1` 得到退出码 4、SIGTERM 得到 `wait_interrupted`、已有未确认答复时立即返回、`--since` 只等新的。S6 在真实宿主的后台任务里再走一次 |
| 5 `answers ack --include <Task README>`：确认文件与 README 在同一个提交里；`--unacked` 不再返回 | L3：断言提交的路径恰好是确认文件与 README |
| 6 引用一张 800 KB 的 PNG：发布成功但有体积警告 | L3（图片用随机字节生成，只看大小）；另测 Task 合计超过 5 MiB 的警告 |
| 7 两个进程同时发布同一个产物：版本号不重复 | L2：两个子进程用不同的 `--title` 同时发布，得到 v1 与 v2，各自的提交都在 |
| 8 `status --json` 列出 t01 与 t03 目录里的 Markdown，作为文档类产物 | L3（临时仓库里建这两个 Task 与几份 Markdown）；S6 在真实仓库只读核对 |
| 9 提问与答复的提交只含产物目录与 `--include` 列出的路径 | L2 每种写入各核对一次 `git diff-tree`；主工作区里放一个无关的已暂存改动，提交后它仍在暂存区 |

另有：L1 标记的每种错误都带行号；L2 认不出的 `schema` 主版本、手改坏的答复只给警告；L3 `ask --artifact` 指向关闭的产物报 `artifact_closed`；L3 内容未变的重复发布不出新版本；L3 `status` 仍不写任何文件。

## 验证

- `bun run --cwd packages/dev-panel test`、`typecheck`。
- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts scripts/ci/workspace-workflows.test.ts scripts/ci/agent-governance.test.ts`。
- `bun run governance:check`、`bun run docs:check`（包文档与 design-review）、`git diff --check`。
- S6：见切片表。真实仓库只读，不发布、不答复、不确认。
- **未验证的边界**：
  - Claude Code 单个后台任务能活多久（S6 只验证几十秒的挂起与唤醒）；
  - 真实仓库里的第一次发布（要开发者授权）；
  - 面板对着旧版本答复（t10）与通知找提问者（t11），本片只提供接口与 L1；
  - `parse5` 对写坏的 HTML 很宽容（例如漏写闭合标签时选项可能落到别的题里），只能靠输出逐题列出来让人看出。

## 不做与风险

- **不做**：面板（t09、t10）；通知（t11）；Work 级产物的发布命令；页面删除文件的提交；产物页里的 Vue 组件（决定 6）。
- **风险**：
  - **按“页面里没有”取代会误伤暂时删掉的题**：输出列 `dropped` 并给警告，`--keep` 可以保留；被取代的题不复活，只能换题号。
  - **标记写错没被发现**：缺题目、缺选项、选项在题外都直接报错；能解析但结构不如预期的，靠输出逐题列出。
  - **主工作区里产物目录有别人的改动**：发布会把目录里所有有变化的文件一起提交，评审板通常只有一个会话在写，输出列出提交了哪些文件。
  - **轮询读到写到一半的答复**：答复由写事务独占创建（先写临时文件，再 link 到位），读的一方只会看到完整的文件。
  - **`--wait` 被宿主结束**：会话看到的就是退出，按原参数重挂；缺省按未确认选答复，不会漏。
  - **`status` 耗时**：现在约 0.97 秒，新增的读取预计不到 30 毫秒，S6 实测；超出时把产物读取放进与 herdr 调用并发的那一段。

## 需要主 Agent 或开发者决定的点

| 点 | 推荐 | 理由 |
|---|---|---|
| 1. 答复的 `submittedBy` 与确认要不要记会话（Proposal 写了 `{kind: "agent-transcribed", session}` 与“哪个会话”） | 不记，与 `askedBy` 同样放运行时的 provenance | 与“项目数据里没有任何字段指向会话”的不变量一致；omp 的会话 id 是本机绝对路径；会话结束后这个字段对读者也没有用 |
| 2. `--wait` 的缺省超时 | 30 分钟，退出码 4 或被宿主结束都按原参数重挂 | Claude Code 后台任务的存活上限没有核实；超时后重挂没有代价 |
| 3. 被取代或撤回的题号能不能复活 | 不能，换题号；暂时删掉用 `--keep` | 复活会让旧答复看起来像在回答新题 |
| 4. Task 关闭时还有 `open` 的必答题 | 只警告，题继续留在收件箱，由会话撤回 | 自动撤回会丢掉“开发者还没答”的事实 |
| 5. design-review 改用 `nbdev artifact publish` 的生效时机 | Skill 与命令行同一次合入；合入后第一次在真实仓库发布仍按 t06 的约定，需要开发者授权 | 合入前的分支上没有命令，Skill 不能先改 |

新增依赖 `parse5` 已在 lockfile 里，属于本地可逆操作，按 P-005 不另外询问。

## 与 Proposal、实施计划的不一致

1. **`askedBy` 不入库**：已记入待确认清单；本计划把同样的做法用到答复的 `submittedBy.session` 与确认的会话上（决定点 1）。
2. **`contentHash` 覆盖整个产物目录**，不是“入口与它引用的本地文件”：子页经链接与 iframe 引用，逐个追引用容易漏。
3. **提问标记比 Proposal 多几个属性**：`data-nb-label`、`data-nb-optional`、`data-nb-recommend`、`data-nb-options` 的一行写法与 `@review`；题可以写在产物里任何一个 `.html` 页上。Proposal 只列了题号、类型与选项标记。
4. **Task 提问集的 `kind` 是 `questions`**，产物 id `questions` 保留：Proposal 的种类只有 `design`、`report`、`review`。
5. **发布记录多了 `action`、`origin`、`since`**；`supersedes` 记上一版的版本号。内容与题都没变时不出新版本。
6. **`--wait` 缺省按未确认的答复返回**（已有未确认的答复时立即退出），另加 `--since`；Proposal 只写“等到有新答复才退出”。被信号打断也用退出码 4。
7. **入口可以是 Markdown**：t80 已有 Markdown 的 omp 审查报告，题用 `ask --artifact` 登记。Proposal 第三节默认入口是 `index.html`。
8. **Work 级产物本片只索引、不能发布**：Proposal 写“少数属于 Work 的，放在 Work 目录下同名的 `artifacts/`”，但命令都以 Task 为单位。
9. **写入要求 Task README 已提交**（`task_not_committed`）：Proposal 没写，与 t06 的 `work_not_committed` 同理。
