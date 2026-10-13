# t10 实施计划：面板写入（答复、新建、状态与编辑）

草案，交主 Agent 与设计审查（编码子代理 2026-10-13 写）。范围以 [实施计划的 t10 一节](../t03-design/plan.md#t10-面板写入答复新建与编辑)（场景 1 到 6）为准；设计依据是 [Proposal](../../../../../docs/proposals/dev-panel.md) 第二节（写事务与护栏）、第三节（产物、提问与答复）、第八节（访问与安全）与待决问题 8；界面依据 t03 [评审板](../t03-design/artifacts/review/index.html) 第三轮的新建表单（`r3/new.html`）与第二轮的产物页（`r2/artifacts.html`）；服务端依据 t09 的 [`docs/panel.md`](../../../../../packages/dev-panel/docs/panel.md)。

## Context

- **要解决的问题**：t09 的面板只读。开发者看到待答的提问、要新建 Work 或 Task、要改状态或改一份记录时，还得回到终端或让会话代办。t10 让这些事在面板上做完，并且与命令行走同一条写入路径：同一个核心函数、同一把锁、同一种路径限定的提交。
- **前提**：t09 已合入集成分支（`fe4358d4f`）。已有的写入都在核心库里：`createWork`、`createTask`、`setRecordStatus`、`setTaskStatus`（`src/core/operations.ts`），`submitAnswer`（`src/core/artifact-ops.ts`），写事务 `runWriteTransaction`（`src/core/transaction.ts`）。面板服务已有登录、`Host` 与 `Origin` 校验，非 `GET` 请求要同源 `Origin` 加 `X-Nbdev-Csrf`（通过后现在回 405）。
- **工作方式**：同前。集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；记录只在主工作区改。验收只在临时仓库上做；**不在真实仓库上用面板写入**，真实仓库第一次写入等开发者授权。
- **约束**：核心库保持 Node 兼容；服务端在 `src/server/`（Bun）；前端在 `src/web/`；零件遵守组件规范；只支持 Linux；不新增前端依赖（见决定点 5）。

## 关键设计

### 一、答复从哪里填

**侧栏表单（必做）**：产物页右边的问题侧栏里，每道活的题（`open` 或已答、没有被撤回或取代）都给输入控件：单选、多选、文字、确认，外加每题的说明与整份答复的备注。一次提交写一份答复文件。Task 提问集没有页面，侧栏表单是它唯一的入口；有页面的产物也用它。

- 表单只按**最新一版**发布记录的题表出控件；切到旧版题表（t09 的版本下拉）时表单变成只读，写“只能对最新一版答复”。答复的 `artifactVersion` 一律是最新一版，`contentHash` 取那一版的值（`submitAnswer` 现有行为）。
- 已答的题照样能改答（再交一份答复，旧的不删，Proposal 第三节）；表单预填现在的取值。
- 提交前在表单里先按题的定义校验（与 `validateAnswerValue` 同一套规则，前端复制一份判据，服务端以 `submitAnswer` 的校验为准）。
- 提交按钮在请求进行中不可再按；两个标签页各交一次就是两份答复，这是 Proposal 第三节认可的行为，不加幂等键。

**页内答复（推荐做，放在最后一片，可以整片砍掉而不影响其余）**：在产物页面的题旁边就地填，填完交给侧栏。

1. **脚本怎么进页面**：产物来源在回应 HTML 文件（`text/html`，只限带随机前缀的 `/a/<前缀>/<checkout>/.agents/works/…` 地址）时改写回应体，在 `</body>` 之前（没有就在末尾）插入一行 `<script src="/a/<前缀>/_nbdev/form.js" defer></script>`。脚本由 t09 留下的保留路径 `/_nbdev/` 提供（只读的静态文件，打在包里）。
   - 不改磁盘文件：`contentHash` 照算磁盘内容，与注入无关。
   - 地址里没有前缀的请求拿不到任何东西（t09 的规则不变），所以只有面板交出去的地址会被注入。“单独打开”在新标签页里打开时脚本也在，但它检查 `window.parent === window`，不是嵌在面板里就什么都不做。
   - 控件放进每个题元素末尾新加的宿主元素的 Shadow DOM 里：页面的 CSS 选择器碰不到控件，控件的样式也不外溢（Proposal 列的“表单脚本与产物页的样式冲突”）。
2. **外壳怎么认消息**：
   - iframe 载入后，外壳向它发 `{type: "nbdev:init", nonce, version, questions}`：`nonce` 每次载入新生成；`questions` 只含最新一版里活的题（题号、类型、选项、现在的取值）。脚本只给这些题号出控件；页面里有、这份清单里没有的题标“这道题没有发布，不能答”。
   - 页内填完按“放进右边的表单”，脚本发 `{type: "nbdev:fill", nonce, values, comments}`。外壳只接受同时满足以下各条的消息，否则丢弃并在侧栏顶部写一行“页面发来一条无效的答复，已忽略”：`event.source === iframe.contentWindow`；`nonce` 是本次载入发出的；`version` 等于当前最新一版；每个题号都在 `questions` 里；每个取值按题的定义合法。
   - 沙箱 iframe 是不透明来源，`event.origin` 是字符串 `"null"`，不能拿来认身份，所以靠 `event.source` 与 `nonce`。
   - 页面自己的脚本也收得到 `init`，能照着发一条合法的 `fill`。所以**页内只负责填表，永远不直接提交**：合法的消息只把取值填进侧栏表单并标出“来自页面，未提交”，开发者在外壳里按“提交”才写入。被页面脚本伪造的取值最多出现在侧栏表单里，开发者看得见。
3. **页面有未发布的改动时**（t09 的 `unpublishedChanges` 为真）：不注入脚本（服务端按磁盘内容的哈希与最新一版的 `contentHash` 比较后决定），页面上方的说明改成“页面有未发布的改动，题目可能与记录不符，请用右边的表单答”。理由：开发者看到的页面与答复记下的 `contentHash` 对不上。哈希算不出（例如产物目录里有符号链接，t09 已给警告）时同样不注入。

### 二、写接口

每个接口直接调命令行用的同一个核心函数，取同一把锁（`.local/agent/registry.json.lock`），不另写一套写逻辑。新增的写入（编辑文件）也写成核心函数，命令行以后可以直接用。

| 接口 | 核心函数 | 请求体上限 |
|---|---|---|
| `POST /api/answers` | `submitAnswer` | 256 KiB |
| `POST /api/works` | `createWork` | 16 KiB |
| `POST /api/works/:workId/tasks` | `createTask` | 16 KiB |
| `POST /api/works/:workId/status` | `setRecordStatus`（Work） | 4 KiB |
| `POST /api/works/:workId/tasks/:taskId/status` | `setTaskStatus` | 4 KiB |
| `PUT /api/files?path=` | 新的 `editRecordFile`（见第五节） | 1 MiB |
| `GET /api/files?path=` | 只读：文本、哈希、是否可编辑、未提交改动的差异 | — |
| `GET /api/preview/work`、`GET /api/preview/task` | 新的 `previewCreateWork`、`previewCreateTask`（不取锁，见第三节） | — |

**每个写请求的校验**（按顺序，失败一律 4xx，不进核心函数）：

1. t09 已有的：转发头、`Host`、登录 cookie、`Sec-Fetch-Site`、同源 `Origin`、`X-Nbdev-Csrf`。
2. `Content-Type` 必须是 `application/json`（415）：浏览器的跨站表单发不出这种请求。
3. 请求体按上表限长，超了回 413（`payload_too_large`），读到上限就停，不读完整个请求体。
4. JSON 解析失败回 400（`usage`）；顶层必须是对象；只接受表里列出的字段，多出的字段回 400（拼错字段名不会被静默忽略）；字段类型不对回 400。
5. 路径参数里的 `workId`、`taskId`、`artifactId` 只接受缓存里存在的值（t09 的规则），不存在回 404。
6. 题号（`values`、`comments` 的键）按 `QUESTION_ID_PATTERN` 校验，存进无原型的对象（t08 实现审查第 8 条的同一做法）。

**错误码映射**（核心库的 `NbdevError` 按退出码分类）：

| 退出码类 | HTTP | 例子 |
|---|---|---|
| 2 用法 | 400 | `usage`、`invalid_slug`、`invalid_title`、`invalid_status`、`invalid_answer` |
| 3 冲突 | 409 | `hash_mismatch`、`uncommitted_changes`、`diff_changed`（新增）、`branch_maintained_record`、`task_closed`、`main_not_on_master`、`main_busy`、`question_closed`、`artifact_closed`、`target_exists` |
| 5 找不到 | 404 | `work_not_found`、`task_not_found`、`artifact_not_found`、`question_not_found` |
| 1 运行失败 | 500；`lock_timeout` 为 503 | `git_failed`、`write_failed`、`git_identity_missing` |

- 写入成功但提交失败（核心返回 `commit.committed: false`）时回 500，`errors[0].code` 是 `commit_failed`，`data.commit.writtenPaths` 列出已写的文件；界面照抄命令行的补救提示（答复：下一次写这个产物时顺带补交；其余：手动提交这些路径）。
- 回应外壳与读接口相同（`{schema, ok, data, warnings, errors, instance, revisions}`）。写成功后服务端立即排一次记录与活动的重算（不等去抖），页面靠 `/ws` 的推送更新列表与收件箱。
- 写请求等锁沿用核心的 30 秒（与命令行相同；比这短的话，持锁者碰上 `index.lock` 时等锁的一方必然超时）。界面在请求超过 2 秒仍未返回时写“在等别的写入完成”。

**面板写入的身份**：面板以开发者身份写，没有会话。

| 字段 | 面板写入时 |
|---|---|
| 答复的 `submittedBy` | `{kind: "developer", device: "local"}`；`device` 在 t13 换成配对设备的名字 |
| 答复的 `submittedAt` | 服务端收到请求的时刻（不信客户端的时钟） |
| 登记表新号的 `by` | `{key: "developer:local", agent: "developer", sessionId: null, label: "local", parentSessionId: null, nestedSessionId: null}`（见决定点 2） |
| 租约 | 不取（`caller: null`）；`setTaskStatus` 改成 `done`、`shelved` 时照常释放这个 Task 的全部租约 |
| provenance | 不写（它记的是“哪个会话写的”） |
| 提交信息 | 在动词前加“面板”，例如 `docs(w00022): 面板新建 t11-notify`，见第五节与决定点 3 |

命令行的 `--as <标签>` 在面板这边没有对应：面板从不冒充会话，也不提供“代录”。

### 三、新建 Work 与 Task

- 表单照第三轮稿（`r3/new.html`）：新建 Work 填短名、标题、目标、Issue（可选）、首个 Task 的短名、标题与状态（`planned` 或 `active`）；新建 Task 填所属 Work（只列来源是 master 或允许写入的 Work）、短名、标题、目标与范围（可选）、状态。Work 本身的状态不给选，一律 `active`（与 `nbdev work new` 相同，见“不一致”第 3 条）。
- **随填随变的预览**：表单任一字段改动后 300 毫秒请求 `GET /api/preview/work`（或 `/task`），显示：
  - 预计领到的号与完整 id（`w00023-<短名>`、`t01-<短名>`）；
  - 要写的文件（仓库根相对路径）与它们的内容（README 模板的渲染结果，与 `workReadmeTemplate`、`taskReadmeTemplate` 同一份）；
  - 提交信息；
  - 字段不合规的原因（与核心的 `assertSlug`、`assertTitle` 同一套校验，逐字段列出）。
- 预览由核心的 `previewCreateWork`、`previewCreateTask` 算：读过渡期信息与编号扫描（`scanNumbers`），**不取锁、不写登记表、不补登 `imported`**。
- **号可能变**：预览区的号旁边写“以提交时为准：提交前有人领了号就顺延”。提交成功后结果区显示实际的 id；与预览不同时多一行“预览时是 w00023，提交时它已被领走，实际领到 w00024”。
- **与命令行同时领号**（场景 3）：两边都进同一个写事务，锁把“扫描、分配、写登记表、落位、提交”串成一段，后进锁的一方扫描时已经看得到先进的一方写的登记表条目，所以拿到下一个号。不需要另写逻辑；验收测这一点（见场景 3）。
- 撞号检查（`reportConflicts`）的警告照常回在 `warnings` 里，界面列出来。

### 四、状态切换

- Work 页与 Task 页的状态徽章旁给一个下拉（nb-ui 的 `FormSelect`），选项为 Work 的 `active`、`done`、`shelved` 或 Task 的 `planned`、`active`、`done`、`shelved`；选了不立即写，弹一次确认（“把 t09 改成完成”），确认后才发请求。
- 只改 frontmatter 的 `status` 与 `updated` 两行：这是 `setRecordStatus` 现有的行为（`setFrontmatterFields` 按行替换，改完重新解析核对）。验收按提交的 diff 只有这两行来判（场景 5）。
- **租约**：Task 切到 `done` 或 `shelved` 时，`setTaskStatus` 写出这个 Task 全部租约的释放记录（`task_done`、`task_shelved`）；就算释放记录没写成，t07 的 `evaluateLeases` 读取时按 Task 状态现算，已关闭的 Task 上的租约也判为 `task_closed`。两条都已存在，t10 不另写。改 Work 的状态不动租约（租约挂在 Task 上）。
- `setTaskStatus` 对还有没答必答题的 Task 给 `open_questions` 警告，界面照列。
- **来自分支的记录**：Work 或 Task 的来源是 `branch` 时不显示下拉，状态旁写“记录在分支 `<分支>` 上维护，在那里改或先迁移”。服务端照样拒绝（核心报 `branch_maintained_record`，409）。
- **乐观并发**：`GET /api/task`、`/api/work` 的回应加上 README 的 `readmeHash`（sha256）。状态请求带 `expectedHash`，核心已支持；文件在打开页面之后被改过就回 409（`hash_mismatch`），界面写“README 在你打开之后被改过”并重新取数。
- **目标文件有未提交的改动**（对应命令行的 `--include-uncommitted`）：
  1. 第一次请求不带 `includeUncommitted`；核心报 `uncommitted_changes`（409），`details` 里有 `git diff HEAD -- <路径>` 的文本与 `status`。
  2. 界面弹一个对话框：上面是差异（等宽字体、增删着色），下面两个按钮：“取消”与“连同这些改动一起提交”。
  3. 选了后者，请求带 `includeUncommitted: true` 与 `acceptedDiffHash`（第 1 步那段差异文本的 sha256）。核心在锁内重新算差异，哈希对不上就报新的 `diff_changed`（409），界面重新显示最新的差异；对得上才写。这样开发者认可的就是实际提交的那份改动。

### 五、编辑

**能编辑的文件**（新的核心函数 `editRecordFile` 在锁内判定，不在白名单上的回 409 `not_editable`，details 写原因）：

| 类 | 路径 | 条件 |
|---|---|---|
| 记录 | `.agents/works/<workId>/README.md`、`.agents/works/<workId>/tasks/<taskId>/README.md` | 记录来源是 master（来自分支的拒绝，`branch_maintained_record`）；文件已经入库 |
| 文档类产物 | Work 与 Task 目录第一层的其它 `.md` | 同上 |
| 主工作区的文档 | t09 文档树在主工作区列出的路径（`classifyDoc` 不为 null） | 文件已存在 |

- 只改已有的文件，不新建、不删除、不改名；只收 UTF-8 文本，不含 NUL，最多 1 MiB。
- **worktree 上的文档不给编辑**：面板的写事务只在主工作区的 `master` 上提交；worktree 是别的会话正在用的工作区，它的 index、未提交改动与分支都属于那个会话，面板的锁也管不到它。要改分支上的 Spec，交给在那个 worktree 里工作的会话。界面上，文档页切到 worktree 时不显示“编辑”。
- **基准哈希**：`GET /api/files` 回文本与它的 sha256；`PUT` 带 `baseHash`，核心在锁内重读文件比对，不一致回 409 `hash_mismatch`（details 带当前的哈希）；界面提示“文件在你打开后被改过”，给“重新载入（丢掉我的改动）”与“复制我的改动”两个按钮，不做三方合并。
- **待决问题 8**：与第四节第 3 步同一套流程。目标文件在 `git status --porcelain` 里有任何条目（工作区改了、暂存了、或是未跟踪的新文件）就默认拒绝（`uncommitted_changes`），给出 `git diff HEAD -- <路径>`（未跟踪的文件给全文）；开发者看过差异、选“连同这些改动一起提交”才放行，并以 `acceptedDiffHash` 绑定他看到的那一份差异。
- **路径限定的提交会带走同一文件里别人已暂存的改动**：`git commit -- <路径>` 提交的是这个路径在工作区里的全部内容。上面的检查把“已暂存”算作未提交的改动，所以这种情形一定先经开发者确认。检查与提交之间还有一个窗口（别的会话不经 nbdev 直接 `git add`）：落位后、提交前在锁内再查一次 `git status`，与落位前的结果不同就不提交，回 409 `uncommitted_changes`（文件已经写了，details 带 `writtenPaths`，界面写清楚“你的改动已在工作区，没有提交”）。
- **编辑器**：nb-ui 的 `FormTextarea` 加一个“预览”切换，预览用 t09 的 `renderMarkdown` 与 `MarkdownView`。不加编辑器依赖（见决定点 5）。离开有未保存改动的编辑页时用浏览器的 `beforeunload` 提示。
- **提交信息**：记录与文档类产物是 `docs(<Work 编号>): 面板编辑 <Task 编号> <文件名>`（Work README 写 `面板编辑 Work README`）；主工作区的文档是 `docs: 面板编辑 <路径>`。
- **`updated`**：编辑 Work 或 Task 的 README 时，核心把它 frontmatter 的 `updated` 改成当天（与状态切换一致；预览里看得到这一行的变化）；编辑 Task 目录里的其它文档不碰 README（见决定点 4）。

### 六、审计

Proposal 第八节第 9 条要求写仓库时记审计（`~/.config/nbdev/audit.jsonl`，权限 600），但建 `~/.config/nbdev/` 要开发者授权，计划在 t11。t10 的处理写成决定点 6，推荐：**t10 不写审计文件**；面板的每次写入都是一个路径限定的提交，提交信息带“面板”，`git log` 能查出面板写过什么、何时写的；t11 获授权建目录后，所有写接口统一加一行审计，不回填 t10 期间的记录。t10 只在回环上开放，登录与 CSRF 校验都在（t09），t13 之前没有别的设备能写。

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test`、`typecheck`、`build:web`。

| 切片 | 改哪些文件 | 加哪些测试 | 提交 |
|---|---|---|---|
| S1 核心 | `src/core/operations.ts`（`previewCreateWork`、`previewCreateTask`；`createWork`、`createTask`、`setRecordStatus` 加可选的 `source: "cli" \| "panel"` 只影响提交信息，与 `acceptedDiffHash`；登记表 `by` 接受开发者身份）；新文件 `src/core/edit-ops.ts`（`editRecordFile`、`readEditableFile`）；`src/core/transaction.ts`（允许写主工作区文档这一类路径：`replaceFile` 的路径护栏扩成“记录或 `classifyDoc` 认得的文档”，仍拒绝符号链接与 `.git`；落位后提交前再查一次目标的 `git status`）；`src/core/errors.ts`（`diff_changed`、`not_editable`、`payload_too_large` 的退出码）；`src/index.ts` 导出 | `tests/panel-writes-core.test.ts`（L2）：预览不写任何文件、不改登记表；编辑记录与文档的白名单（来自分支、worktree、不在树上、符号链接、`.git`、新文件都拒绝）；`baseHash` 不一致；未提交改动默认拒绝、`acceptedDiffHash` 对上才写、对不上报 `diff_changed`；暂存了的改动也算；README 编辑改 `updated`；提交信息带“面板” | `feat(dev-panel): 面板写入要用的核心：预览、编辑与差异确认（w00022 t10）` |
| S2 写接口 | `src/server/writes.ts`（新：请求体读取与限长、字段校验、错误码映射、各写接口）；`src/server/serve.ts`（非 `GET` 在 CSRF 之后交给 `writes.ts`，不再一律 405；`Content-Type` 校验）；`src/server/views.ts`（`readmeHash`、`GET /api/files`、预览接口）；`src/server/state.ts`（写成功后立即重算） | `tests/panel-writes.test.ts`（L3，进程内起服务，同 t09 的做法）：场景 1、3、4、5、6 的接口部分；伪造题号（场景 2 的服务端部分）；415、413、多余字段、缺 CSRF、跨来源、没登录；错误码到 HTTP 的映射；提交失败回 500 带 `writtenPaths` | `feat(dev-panel): 面板的写接口（w00022 t10）` |
| S3 前端 | 新零件（各带同名 `.md`）：`AnswerForm`（侧栏表单）、`NewWorkForm`、`NewTaskForm`、`CreatePreview`、`StatusSwitch`、`DiffView`、`FileEditor`；页面：`ArtifactPage`（侧栏换成表单加原有的已答与已取代）、`WorkPage`、`TaskPage`（状态下拉、编辑入口）、新页 `/new`（新建 Work 与 Task）、`/edit?path=`；`host/api.ts`（写请求带 CSRF 头与 JSON）；`docs/panel.md` | 前端没有单元测试框架，零件的状态在浏览器验收里摆出来（同 t09）；`vue-tsc` 类型检查 | `feat(dev-panel): 答复表单、新建、状态切换与编辑页（w00022 t10）` |
| S4 页内答复（可以整片砍掉） | `src/server/serve.ts`（产物来源对 HTML 回应注入脚本，`_nbdev/form.js` 走保留路径）；新文件 `src/server/artifact-form.js`（原生 JS，Shadow DOM 控件）；`src/web/host/page-answers.ts`（消息校验，纯函数）；`ArtifactPage` 接上 | L1：`page-answers.ts` 的校验（来源不对、nonce 不对、版本不对、题号不在清单、取值不合法、合法）；L3：注入只发生在带前缀的 HTML 回应、有未发布改动时不注入、`_nbdev/form.js` 能取到、其余 `_nbdev/` 路径 404 | `feat(dev-panel): 产物页内就地答复（w00022 t10）` |
| S5 文档与验收 | `docs/panel.md`（写接口、身份、编辑与差异确认、页内答复）、`docs/cli.md`（新错误码）、`docs/file-formats.md`（登记表 `by` 的开发者身份）、包 `AGENTS.md`；浏览器验收（只在临时仓库）；L4 | 场景 1 的 L4（见下）；浏览器走一遍答复、新建、状态、编辑、伪造题号 | 文档一个提交；验收结果不提交，交主 Agent 写进 Task README |

## 接口与数据

**请求体**（字段之外的一律 400）：

```ts
// POST /api/answers
type AnswerBody = {workId: string; taskId: string | null; artifactId: string; version: number; values: Record<string, unknown>; comments?: Record<string, string>; note?: string | null};
// POST /api/works
type WorkBody = {slug: string; title: string; goal: string; issue?: number | null; taskSlug: string; taskTitle?: string | null; taskStatus?: "planned" | "active"};
// POST /api/works/:workId/tasks
type TaskBody = {slug: string; title: string; goal?: string | null; status?: "planned" | "active"};
// POST …/status
type StatusBody = {status: string; expectedHash: string; includeUncommitted?: boolean; acceptedDiffHash?: string | null};
// PUT /api/files?path=
type EditBody = {content: string; baseHash: string; includeUncommitted?: boolean; acceptedDiffHash?: string | null};
```

- `AnswerBody.version` 必须等于最新一版（否则 409 `stale_version`，界面重新取数）；`note` 最长 2000 字；`comments` 每条最长 2000 字；`values` 至少一个键。
- `GET /api/files?path=` 回 `{path, kind: "readme" | "task_document" | "repo_doc", text, hash, editable, reason, uncommitted: null | {status: string[], diff: string | null, diffHash: string}}`：`kind` 对应第五节的三类（Work 与 Task 的 README、文档类产物、主工作区的文档）；`reason` 是不可编辑的原因码（`branch_maintained_record`、`not_in_main`、`not_editable`）。
- `GET /api/preview/work?slug=&title=&goal=&issue=&taskSlug=&taskTitle=&taskStatus=` 与 `GET /api/preview/task?workId=&slug=&title=&goal=&status=` 回 `{workId, taskId, paths: string[], files: Record<path, string>, message, problems: Array<{field, code, message}>}`；字段不全时 `problems` 非空、其余字段尽量给出。
- 写接口成功时 `data` 与命令行的 `--json` 相同（`nbdev.answers-record/v1`、`nbdev.work-new/v1` 等的 `data`），另加 `commit`。

**核心新增**：

```ts
previewCreateWork(context, input): Promise<{workId, taskId, paths, files, message, problems}>;
previewCreateTask(context, input): Promise<{workId, taskId, paths, files, message, problems}>;
readEditableFile(context, path): Promise<{kind, text, hash, editable, reason, uncommitted}>;
editRecordFile(context, {path, content, baseHash, includeUncommitted, acceptedDiffHash, source}, options): Promise<OperationResult<{path, kind, previousHash, nextHash, changed}>>;
```

- 内容与原文相同（改完 `updated` 之后仍相同）时不写不提交，`changed: false`。
- `acceptedDiffHash` 是 `git diff HEAD -- <路径>` 输出文本的 sha256（未跟踪的文件用全文）。

**新错误码**：`diff_changed`（3）、`not_editable`（3）、`stale_version`（3）、`payload_too_large`（2，服务端用）。

## 验收场景与测法

不在真实仓库上用面板写入。浏览器验收照 t09：Playwright 加 `/usr/bin/google-chrome-stable`，在临时仓库上起 `nbdev panel serve`，`nbdev panel open --print` 拿登录链接，截图留在本地 `.local/agent/works/w00022-dev-panel/tasks/t10-panel-writes/shots/`。

| 场景 | 测法 |
|---|---|
| 1 产物页答两道题并提交：主工作区多一个只含一份答复文件的提交；另一个终端里挂着的 `answers --wait` 退出并拿到答复 | **L3**（`tests/panel-writes.test.ts`）：临时仓库发布一个两道题的产物；子进程起 `nbdev answers w t review --wait --timeout 60 --json`（t08 的 `startWaiter`，等 stderr 出现“等待中”）；`POST /api/answers` 带两个取值；断言回应 200、`git diff-tree` 只有一个 `answers/<id>.json`、答复的 `submittedBy` 是 `{kind: "developer", device: "local"}`；断言等待的子进程 5 秒内以 0 退出、`unacked` 里是这份答复。**L4**（`tests/herdr-live.test.ts` 加一条，在命名会话 `nbdev-test` 里）：在一格 pane 里跑 `answers --wait`，面板 `POST` 后断言那格 pane 的命令退出（读 pane 的输出或命令的退出标记），用完删会话。**浏览器**：侧栏表单选一个选项、填一段文字、提交，页面显示“已提交”，题移到“已答” |
| 2 在产物 iframe 里伪造一道发布记录里没有的题号：外壳拒绝，不写文件 | **服务端（L3）**：`POST /api/answers` 带一个不存在的题号，回 404 `question_not_found`，`answers/` 下没有新文件、`git status` 不变。**外壳（L1，S4）**：`page-answers.ts` 的校验对不在清单里的题号、`event.source` 不是这个 iframe、`nonce` 不对的消息都返回拒绝。**浏览器（S4）**：在 iframe 里 `parent.postMessage({type: "nbdev:fill", nonce: <页面收到的>, values: {"no-such": "x"}}, "*")`，断言侧栏表单没有被填、出现“无效的答复”一行、没有发出 `POST`（拦截网络请求计数）、`answers/` 下没有新文件。S4 被砍掉时只保留服务端那条，记进“不一致” |
| 3 面板新建 Work，同时终端运行 `nbdev work new`：两边拿到不同的号，都通过 `governance:check` | **L3**：同时发出 `POST /api/works` 与子进程 `nbdev work new … --as bob --json`（`Promise.all`）；断言两个 `workId` 的编号不同、各自的 README 都已提交、登记表里两条都是 `claimed`，面板那条的 `by` 是开发者身份。**根测试**（Node，`scripts/ci/dev-panel-records.test.ts`）：并发调用两次 `createWork`（一次 `source: "panel"`），对临时仓库跑 `verifyWorkContracts` 无错误；面板与命令行调的是同一个核心函数，这一条等价于“都通过 governance:check” |
| 4 会话改了某 Task README 没提交，开发者在面板上改同一个文件：面板给出差异并拒绝 | **L3**：直接写 Task README 的一行（扮成会话）；`GET /api/files` 的 `uncommitted.diff` 含这一行；`PUT` 不带 `includeUncommitted` 回 409 `uncommitted_changes`，details 带差异；带 `includeUncommitted` 与错误的 `acceptedDiffHash` 回 409 `diff_changed`；带对的哈希回 200，提交里同时有两处改动；另测把改动 `git add` 之后照样被拒；测 `baseHash` 过期回 409 `hash_mismatch`。**浏览器**：编辑页保存时弹出差异对话框，选“取消”后文件不变 |
| 5 面板把某 Task 改为 `done`：frontmatter 只改了 `status` 与 `updated`；租约被释放 | **L3**：先用 `nbdev lease take … --as bob` 取一份租约；`POST …/status` `{status: "done", expectedHash}`；断言提交的 `git show --stat` 只有这个 README、`git diff <提交>^ <提交>` 只有 `status` 与 `updated` 两行变化；租约目录里那份租约有 `releasedAt`、`releaseReason: "task_done"`；`nbdev lease list --json` 里它的 `state` 是 `released`；`/api/overview` 里这个 Task 的 `leaseCount` 为 0。**浏览器**：Task 页的状态下拉改成完成，确认后徽章变为“完成” |
| 6 打开一个“来自分支”的 Task：没有编辑入口 | **L3**：临时仓库里建一个记录在 worktree 分支上维护的 Work；`GET /api/files?path=<它的 Task README>` 的 `editable` 为 false、`reason` 为 `branch_maintained_record`；`PUT` 与状态 `POST` 都回 409；新建 Task 照常写进 master（与命令行相同）。**浏览器**：这个 Task 的页面上没有状态下拉与“编辑”按钮，状态旁有“记录在分支上维护”的说明 |

- **安全（L3）**：没登录 401；缺 CSRF 头 403；跨来源 `Origin` 403；`Sec-Fetch-Site: cross-site` 403；`Content-Type: text/plain` 415；超长请求体 413；多余字段 400；对写接口发 `GET` 405。
- **只读不变量（L3，沿用 t09 场景 6 的做法）**：只发预览请求与 `GET /api/files` 之后，`find -newer <标记>` 在主工作区、worktree 与 Git 公共目录里没有结果。
- **验证命令**：`bun run --cwd packages/dev-panel test`、`typecheck`、`build:web`；根上三个测试文件；`bun run governance:check`、`bun run docs:check`、`git diff --check`。面板进程用会话的后台机制起，记 PID，用完 SIGTERM；收尾确认没有残留进程、命名 herdr 会话已删。

## 决定点

| 点 | 推荐 | 理由 |
|---|---|---|
| 1. 页内答复做不做 | 两条都做：侧栏表单是唯一的提交入口；页内控件只把取值填进侧栏，放在 S4，验收或审查认为风险大时整片砍掉，不影响其余 | 侧栏是 Task 提问集唯一可能的入口，必做；页内答复是方便，且场景 2 测的就是它的消息通道。页内不直接提交，页面脚本伪造的取值最多出现在开发者眼前的表单里 |
| 2. 面板新号在登记表里记谁 | `by` 记开发者身份 `{key: "developer:local", agent: "developer", label: "local", 其余 null}` | `null` 已经表示“认不出的调用者”，混用会让登记表分不清是开发者建的还是来历不明；形状沿用现有的 `RegistryBy`，读取不用改 |
| 3. 提交信息是否标“面板” | 标：动词前加“面板”（`面板新建`、`面板编辑`、`面板记下`、状态改为……的提交加“（面板）”）。核心函数加可选的 `source`，缺省为命令行，现有的提交信息不变 | t10 没有审计文件，提交信息是唯一能查出“面板写过什么”的地方；答复的提交信息已分“记下”与“代录”，这里只多两个字 |
| 4. 编辑 README 以外的文档时改不改 README 的 `updated` | 不改；编辑 README 本身时改。另外把首页的“最近更新”扩成取 `updated` 与 Task 目录第一层文档、产物目录的最后提交日期中较晚的那个（t09 只看产物目录） | 改 README 就要连带一个可能有别人未提交改动的第二个文件，又得走一遍差异确认；提交日期已经能反映文档的改动 |
| 5. 编辑器 | nb-ui 的 `FormTextarea` 加预览，不加依赖 | 编辑的是 Markdown 记录，多数改动是几行；代码编辑器（CodeMirror、Monaco）要几百 KB 依赖与主题适配，换来的语法高亮在这里收益小 |
| 6. 审计 | t10 不写审计文件；提交信息标“面板”；t11 获授权建 `~/.config/nbdev/` 后统一加审计、不回填 | 建用户级目录要开发者授权，计划在 t11；Proposal 不放 `.local/agent/` 的理由（Agent 能改）依然成立，放那里不如不放；t13 之前只有本机能登录 |
| 7. 主工作区的文档（Spec 等）给不给编辑 | 给，但只限已存在、在文档树上的文件；提交直接进 master | Proposal 决定 11“先不限制写什么”；仓库规则允许“用户明确指定的主工作区改动”直接在主工作区完成，开发者亲手在面板上改就是这种情形。代价见风险第 3 条 |
| 8. 未提交改动的放行要不要绑定差异 | 要：`acceptedDiffHash` 对不上就 `diff_changed` | 只靠一个布尔开关，开发者看完差异到按下按钮之间别的会话又改了，提交的就不是他认可的内容 |

## 与 Proposal、实施计划的不一致

1. **页内答复不直接提交**：实施计划写“答案经 `postMessage` 交给外壳，外壳按发布记录校验”后提交；本计划改为页内只填侧栏、在外壳里确认后提交。原因见第一节：页面脚本收得到初始化消息，能伪造合法的取值。
2. **页内答复可能整片砍掉**（决定点 1）：砍掉时场景 2 只剩服务端那条（伪造题号的 `POST` 被拒）。
3. **新建 Work 不选 Work 的状态**：第三轮稿的新建 Work 表单有“状态 active、shelved”，`nbdev work new` 没有这个参数（新 Work 一律 `active`）；本片与命令行保持一致，要搁置就建完再改状态。
4. **审计推迟到 t11**（决定点 6）：Proposal 第八节第 9 条要求写仓库时记审计。
5. **worktree 上的文档不给编辑**：Proposal 决定 11 说“先不限制写什么”；本片只写主工作区（理由见第五节）。
6. **“写入某个 Task 的文件时同时改 `updated`”只对 README 本身成立**（决定点 4）：Proposal 第二节写的是写入 Task 的任何文件都改。
7. **答复只能针对最新一版**：Proposal 第三节说“开发者对着旧版本提交时照收，按旧版本记”。面板的表单只给最新一版出控件（旧版题表只读）；核心的 `submitAnswer` 仍接受旧版本（命令行与以后的面板都能用），只是面板不提供这个入口，因为产物页的页面始终是磁盘上的当前版本（t09），对着旧题表答容易答错题意。
8. **`submittedBy.device` 在 t13 之前一律是 `local`**：Proposal 的设备名来自配对，t13 才有。

## 风险

按影响排序；前两条是我认为最大的两处。

1. **路径限定的提交与别人的改动**：检查“目标文件没有未提交改动”与提交之间，别的会话可能不经 nbdev 直接改或暂存同一个文件（它们不取我们的锁）。对策：检查在锁内、紧贴提交；落位后提交前再查一次 `git status`，变了就不提交、回 409 并写清“你的改动已在工作区”；差异放行绑定 `acceptedDiffHash`。剩下的窗口是“第二次检查到 `git commit` 之间”的几十毫秒，无法完全消除；被带走的改动会出现在面板的提交里，`git show` 看得见。
2. **页内答复的注入与消息通道**：改写 HTML 回应可能碰上没有 `</body>`、非 UTF-8、页面自带 CSP（`<meta http-equiv>` 禁了脚本）的页面；沙箱 iframe 的来源是 `"null"`，只能靠 `event.source` 与 `nonce` 认消息，而页面自己的脚本也收得到 `nonce`。对策：页内永不直接提交；注入失败（页面禁了脚本）时页面上没有控件，侧栏表单照常可用；控件放在 Shadow DOM 里；有未发布改动时不注入；整片可以砍掉。
3. **面板直接改 master 上的 Spec**：绕过了分支与审查，和在某个 worktree 上改同一份 Spec 的会话会在合并时冲突。对策：只给已存在、在文档树上的文件；文档页显示“这些分支改了它”（t09 已有），编辑页在有分支改过时多一行提醒；是否放开交开发者在决定点 7 定。
4. **预览的号与实际的号不同**：预览不取锁。界面明确写“以提交时为准”，结果区写出差别；不会造成撞号，因为真领号在锁内。
5. **写请求等锁最长 30 秒**：浏览器请求会挂这么久。界面在 2 秒后提示“在等别的写入完成”，超时回 503 并让开发者重试。
6. **前端表单的校验与核心的校验不一致**：前端复制了一份规则，可能落后于核心。服务端始终以核心的校验为准，前端的只用于提前提示；验收里有“前端放行、服务端拒绝”的用例（构造一个前端不拦的非法值直接 `POST`）。
