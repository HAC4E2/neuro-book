# w00022 实施计划

草案，与 [Proposal](../../../../../docs/proposals/dev-panel.md) 一起交开发者；Proposal 改为 `accepted` 之后才按本计划建 Task。方案、取舍与待决问题以 Proposal 为准，本文只讲怎么切片、按什么顺序、怎么验收。

## 前提

- Proposal 由开发者接受；开工前要定的待决问题标在各切片的“依赖”里。
- [t04](../t04-rule-followups/README.md) 第 2 项（Task 号允许三位、改治理检查的正则）先合入。它改动小、互不依赖；`nbdev` 的编号格式要与它一致。
- 第三轮评审板的待定项（首页 Work 区用卡片还是表）与第二轮里仍待定的页面细节，是面板各切片的前提；命令行各切片不依赖界面。
- 每个 Task 一个 worktree：`.worktree/w00022-t<NN>-<短名>`，分支 `feat/w00022-t<NN>-<短名>`（[Work 规则](../../../README.md#创建与执行)）。Task 记录在主工作区维护；原始输出放 `.local/agent/works/w00022-dev-panel/tasks/t<NN>-…/`，验证结论以文字写进 Task README。
- 验证按 [测试规范的验证门禁](../../../../../docs/testing/README.md#验证门禁)：通用包用 `bun test`，按 L1 到 L4 分层；临时根用 `@notnotype/neuro-book-test-support` 的 `createTestTmpRoot`；界面按 [UI 验收分档](../../../../../docs/testing/README.md#ui-验收分档) 取证。

## 顺序与理由

| Task | 切片 | 依赖 |
|---|---|---|
| t06 | 命令行核心：包骨架、写事务、记录读取（含过渡期）、领号 | Proposal，t04 第 2 项 |
| t07 | 会话身份、运行归属与租约 | t06 |
| t08 | 产物、提问与答复（命令行） | t06、t07 |
| t09 | 面板服务与只读视图 | t06 到 t08，首页与各页定稿 |
| t10 | 面板写入：答复、新建与编辑 | t08、t09 |
| t11 | 通知、会话消息与常驻 | t07、t10 |
| t12 | herdr 网页终端 | t09、t11 |
| t13 | 跨设备访问 | t10 到 t12 |
| t14 | 运行登记、开发服务与现场补充 | 命令行部分依赖 t06，面板部分依赖 t09；可与 t09 起的各片并行 |

基本沿用“先命令行核心，再只读面板，再答复与通知，再终端，最后跨设备”的顺序，调整了三处：

1. **租约单独成片（t07），排在产物之前**：提问要记下提问者租约（`askedBy`），通知也按租约找人；身份识别、运行归属与租约是一块独立、可单测的运行时逻辑。
2. **面板写入（t10）与通知（t11）分开**：答复入库与 herdr 投递的风险不同。先保证“答复落盘、任何会话能读”，再接上“主动通知”；通知出问题时，答复通道不受影响。
3. **运行登记与开发服务（t14）放到最后，可以并行**：`dev start`、`worktree new`、`find`、`shot` 是需求分析第七节的第一版候选，但它们不在“第二条沟通通道”这条主线上，与面板各片互不阻塞。

先做命令行的理由：最常出事的编号冲突只靠命令行就能解决；面板只是同一核心库的第二个入口，核心先定，面板就薄；命令行可以在界面细节还没定时开工。跨设备放最后，因为它扩大了攻击面，要等所有写操作与终端操作都有了分级之后再开。

## t06 命令行核心：包骨架、写事务、记录读取与领号

- **目标**：任何 checkout 里的会话都能用 `nbdev` 领号、新建 Work 与 Task、改状态，记录直接提交到主工作区 `master`；`nbdev status` 能正确显示所有 Work，包括记录还在分支上的。
- **范围**：
  - 新包 `packages/dev-panel` 与登记：根 `workspaces` 与根 devDependencies（一致性测试要导入它），`packages/AGENTS.md`，Monorepo 边界的表格；包内 `AGENTS.md`、`CONTEXT.md`，`docs/` 下命令行合同与文件格式的第一版。
  - 核心库：
    - 定位主工作区与调用者所在的 checkout；
    - 编号格式（Task 两位与三位）；
    - 记录读取：frontmatter 的 schema、id、`status`、`updated`，以及“目标”一节；
    - 过渡期读法：判定没迁的 Work，从执行 worktree 读并标“来自分支”，与 `master` 上的 Task 合成一张列表；
    - 缺字段时标“未标”，推断值标“推断”；
    - 写事务：锁、临时目录改名、哈希比对、路径限定提交、`index.lock` 退避重试，写入时更新 `updated`（按待决问题 4 的结果）；
    - 登记表与导入。公开入口只用 Node 兼容的 API。
  - 命令：`work new`、`task new`、`work status`、`task status`、`registry import`、`status`（Work、Task、状态、来源、编号冲突）；`--json` 外壳与退出码。改一份还在分支上维护的记录时，以退出码 3 拒绝。
  - 包脚本 `install-shim`，写入 `~/.local/bin/nbdev`。
  - 一致性测试 `scripts/ci/dev-panel-records.test.ts`：导入包的公开入口，在临时仓库里建 Work 与 Task（含 t100），再跑 `verifyWorkContracts`，并比对编号格式。
  - 规则：Work 规则的“编号分配”改为经 `nbdev` 领号（与本片同一次合入，见 Proposal 待决问题 16）；`.agents/works/AGENTS.md` 第 1、3 条；`.local/README.md` 加登记表、锁与 `run/tmp/`；如采用 `updated`，就写进 Work 规则。
- **非目标**：租约（t07）、产物与提问（t08）、面板、herdr；替其它会话迁移记录。
- **依赖**：Proposal accepted；t04 第 2 项；待决问题 4、15、16。
- **验收场景**：
  1. 临时仓库里准备好：主工作区、两个 worktree、一个未跟踪的占号目录、一个只在分支上的 Work、一个远程跟踪分支。在 worktree 里运行 `nbdev work new`：拿到所有来源里最大值加一的号；README 出现在主工作区；`master` 上多一个只含这两个 README 的提交。
  2. 主工作区暂存区里预先放好另一个文件的改动。运行 `nbdev task new` 之后，这个改动仍在暂存区，没有进提交。
  3. 同时起 10 个 `nbdev task new`（模拟网页与命令行同时领号）：号各不相同且连续，登记表是合法 JSON，`git log` 有 10 个提交。
  4. 用核心库在临时仓库里建出的 Work 与 Task（含 t100）全部通过 `verifyWorkContracts`。
  5. 主工作区检出的不是 `master`：`work new` 退出码 3，不写任何文件。
  6. 有两个同号不同名的 Work：`work new` 照常发号，并在 `conflicts[]` 里列出两处位置。
  7. 临时仓库里，一个 Work 的记录在执行 worktree 的分支上较新，另有一个只在 `master` 上的 Task：`status --json` 把前者标为 `source: branch`（带分支名），后者标为 `source: master`；对前者运行 `task status` 退出码 3。
  8. 在真实仓库运行 `nbdev status --work w00017 --json`：t80、t81 来自 `master`，其余来自 w00017 主线 worktree 并标“来自分支”；没有 `status` 的 Task 标 `unset`。
  9. 在真实仓库运行 `nbdev registry import --json`：给出的下一个 Work 号与 w00017 的下一个 Task 号与手工扫描一致；只写 `.local/agent/registry.json`。
  10. `index.lock` 被占 15 秒：命令退出码 1，输出 `committed: false`，并列出已写的文件。
- **验证**：
  - `bun run --cwd packages/dev-panel test`：L1 编号、frontmatter、来源判定；L2 写事务、扫描与过渡期读法，用临时 Git 仓库；L3 命令行合同；L4 并发进程领号；
  - `bun run --cwd packages/dev-panel typecheck`；
  - `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts`；
  - `bun run governance:check`、`bun run docs:check`；
  - 提交前 `git diff --cached --check`。
- **风险**：
  - w00017 分支改过 `workspaces`，合并时会冲突；
  - `bun install` 慢时加 `prox`；
  - 根脚本测试在 Node 下运行，核心库的公开入口不能用 Bun 专有的 API；
  - `git add` 与 `git commit` 之间，别的会话不加路径的提交可能把文件带走：要检测出来并给出警告；
  - 长期分支的会话读的仍是旧规则，可能继续手工建号（由扫描兜底）；
  - “执行 worktree”的认法是启发式，有几份副本时要明确标出。
- **需要开发者授权或决定**：新包登记；CI 矩阵是否纳入；写入 `~/.local/bin/nbdev`；在真实仓库第一次用 `nbdev` 建 Work；合入 `master`。

## t07 会话身份、运行归属与租约

- **目标**：命令行认得出调用它的会话；Task 相关操作顺手取得或续期租约；`status` 能回答“现在有谁在动”，并把会话与它的运行分开列出。
- **范围**：
  - 身份识别：Claude 的环境变量、子代理、`herdr agent get`；会话派出的进程（例如 `omp -p`）按派出它的会话认；开发者手动起的才算外部会话；`--as`。
  - 租约：文件格式、失效计算（herdr 会话列表、24 小时）、最近活动时间；`nbdev lease take`、`nbdev lease list`、`nbdev release`；Task 状态改成 `done` 或 `shelved` 时自动释放；给 t06 的 `task new`、`task status` 接上租约。
  - herdr pane 标签（`report-metadata`，`--ttl-ms 86400000`）。
  - 运行的发现与归属：本仓库 cwd 的进程，沿父进程链对到 `herdr pane process-info` 给出的 pane，对不上的归“无主”；运行不持有租约。
  - herdr 只读调用的最小客户端（`agent.list`、`agent.get`、`pane.process_info`）；没有 herdr 时降级。
  - `status` 输出“谁在动”（带最近活动时间）与各会话的运行。
  - `.local/README.md` 补 `run/leases/`、`run/procs/`。
- **非目标**：通知、面板、`dev start`（t14）。
- **依赖**：t06；待决问题 10。
- **验收场景**：
  1. 在 herdr 里的 Claude Code 会话中运行 `nbdev task new`：租约记下会话 id 与 pane；`herdr pane get <pane>` 显示 `work`、`task` 标签。
  2. 子代理里运行同一条命令，以及会话用 Bash 派出的 `omp -p` 里运行 `nbdev answers`：租约都记在父会话名下，不出现新的外部会话。
  3. 在没有 herdr 环境变量的终端里运行 `nbdev lease take --as review-bot`：出现一个外部会话的租约。
  4. 把 `lastActivityAt` 改成 25 小时前（或注入时钟）：`lease list` 标为失效，`status` 不再显示；改成 3 小时前：仍然有效，`status --json` 带出最近活动时间。
  5. 用 `nbdev task status … done` 把 Task 标为完成：这个 Task 的全部租约被释放。
  6. 在假 herdr 里删掉会话：租约失效。
  7. 会话派出一个长时间运行的子进程，且会话已 idle：`status` 里这个会话显示 idle，它名下另列一个运行；直接在普通 shell pane 里起的开发服务归“无主”。
  8. herdr 不在运行：命令照常完成，输出一条警告，租约只按 24 小时规则失效。
- **验证**：
  - 包测试：L1 失效计算与父进程链；L3 假 herdr socket；L4 在单独命名的 herdr 会话（`herdr --session nbdev-test`）里跑，用完删除，本机没有 herdr 时跳过并记为未验证；
  - typecheck；`governance:check`。
- **风险**：omp 在 herdr 外的会话 id 取法未核实；`/proc` 父进程链在进程已退出、被收养（ppid 为 1）时会断，断了就归“无主”；pane 标签最多 16 个。
- **需要开发者授权或决定**：L4 测试会在本机 herdr server 里建一个命名会话（不碰默认会话），属本地可逆操作，开工时说明一声即可。

## t08 产物、提问与答复（命令行）

- **目标**：Agent 能发布带提问的产物、在会话里登记口头提问、读答复、确认采纳，提问都有结局；文件格式定稿。
- **范围**：
  - 发布记录；用 HTML 解析器解析提问标记；
  - 挂在 Task 上的提问（存法按待决问题 6）；
  - 提问的四种结局（`open`、`answered`、`withdrawn`、`superseded`）；
  - 答复与确认的格式；状态现算；图片体积检查；
  - 文档类产物的索引（Task 目录里的 Markdown，按待决问题 5）；
  - 命令：`artifact publish`、`artifact close`、`ask`（含 `withdraw`、`supersede`、`--artifact`、`--about`）、`answers`（含 `--wait`）、`answers ack`、`answers record`；
  - `status` 输出收件箱；
  - `docs/` 写定格式，附一个提问标记的例子页；
  - design-review 改为用 `nbdev artifact publish` 发布评审板。
- **非目标**：面板。本片里答复只由测试或 `answers record` 写入。
- **依赖**：t06、t07；待决问题 5、6、7。
- **验收场景**：
  1. 给 t03 的评审板加两道 `data-nb-question` 后发布：生成 `versions/v1.json`，题号、类型、选项与页面一致，`askedBy` 是当前会话的租约。
  2. 改掉一道题的题号再发布 v2：旧题号标为 `superseded`；它的旧答复标为针对 v1；新题回到 `open`；收件箱的待答数不包含被取代的题。
  3. `nbdev ask w00022 t03 --id migrate-order --type text --label …`：Task 的提问集里多出一道 `open` 题，收件箱里能看到；`ask withdraw` 之后这道题从收件箱消失。
  4. 在另一个终端挂上 `nbdev answers … --wait --timeout 60`，再用核心库写入一份答复并提交：等待的命令几秒内退出，并输出这份答复。
  5. `answers ack --include <Task README>`：确认文件与 README 在同一个提交里；`answers --unacked` 不再返回它。
  6. 引用一张 800 KB 的 PNG：发布成功，但给出体积警告。
  7. 两个进程同时发布同一个产物：版本号不重复。
  8. `status --json` 列出 t01 与 t03 目录里的 Markdown，作为文档类产物，不要求它们在 `artifacts/` 下。
  9. 提问与答复的提交只含产物目录，以及 `--include` 列出的路径。
- **验证**：
  - 包测试：L1 标记解析、状态与结局推导；L2 文件格式与只追加；L3 命令合同；
  - typecheck；一致性测试；`governance:check`；`docs:check`（design-review 与包文档）。
- **风险**：标记写法要让 Agent 容易写；评审板体积；`--wait` 受 Claude Code 后台任务存活上限的限制；“新版本里不再出现即被取代”可能误伤只是暂时删掉的题，所以输出里要列出这些题。

## t09 面板服务与只读视图

- **目标**：开发者在本机浏览器里看全局：首页、Work › Task、产物（带只读的问题侧栏）、文档、会话（只读）、搜索。
- **范围**：
  - Bun 服务（HTTP 与 WebSocket 骨架）；两个来源（端口按待决问题 3）；
  - 请求校验：`Host`、`Origin`、CSRF；拒绝带转发头的请求；文件服务的路径守卫；
  - 前端技术按待决问题 2，包括验证 nb-ui 组件能否脱离 Nuxt 使用；
  - 视图按 t03 定稿的静态稿，首页 Work 区按待决问题 1：
    - 持久与临时的数据分开画，“推断”与“来自分支”都要标出；
    - 会话以会话 id 加 Agent 名称认，状态与运行分开列；
    - “谁在动”带最近活动时间，超过 2 小时的淡化显示；
  - 会话数据来自 `session.snapshot` 加 `events.subscribe`；
  - `nbdev panel serve`、`nbdev panel open`、`panel.json`；HEAD 变化时提示；
  - 搜索：跨 checkout 搜文件名与内容。
- **非目标**：任何写入、通知、终端、配对、跨设备。
- **依赖**：t06 到 t08；t03 第三轮与第二轮的页面定稿；待决问题 1、2、3、13。
- **验收场景**：
  1. 首页列出全部 Work：w00022 显示真实的状态与目标；w00017 显示“来自分支”的警示；没有字段的显示“未标”。t08 发布的提问在收件箱里；herdr 里的会话状态变化 1 秒内反映到页面。
  2. 从 Work 展开 Task、打开产物：产物在第二个来源的 iframe 里渲染，侧栏列出题与已有答复；被取代的题折叠显示。
  3. 文档页默认看 `master`；从 Task 进入时切到该 Task 的 checkout，并标出与 `master` 的差异。
  4. 一个会话 idle、但它派出的 omp 审查还在跑：会话页显示 idle，下面另列这个运行。
  5. 安全：`Host: evil.example` 的请求被拒；跨来源的 POST 与 WebSocket 升级被拒；`/../.git/config` 与指向仓库外的符号链接被拒；带 `X-Forwarded-For` 的请求被拒。
  6. 浏览一轮之后，主工作区的 `git status` 与文件哈希不变（只读保证）。
  7. 在本机 11 个 checkout 的情况下，首页首屏不超过 1 秒。
- **验证**：
  - 包测试：服务端只读测试与安全测试；L3 假 herdr；
  - typecheck；前端构建；
  - 浏览器按 UI 验收分档的“普通 UI 改动”走一遍实际交互；
  - `governance:check`。
- **风险**：nb-ui 能否在 Nuxt 之外使用；页面没定稿就开工会返工；herdr 丢事件时的对账；过渡期“来自分支”的认法出错时会显示错误的 Work。
- **需要开发者授权或决定**：前端技术选型（待决问题 2）；首页 Work 区的形式（待决问题 1）。

## t10 面板写入：答复、新建与编辑

- **目标**：开发者在面板上答复提问、新建 Work 与 Task、改状态、编辑记录与文档，全部入库。
- **范围**：
  - 产物页表单：面板把脚本注入产物来源，答案经 `postMessage` 交给外壳，外壳按发布记录校验；
  - 答复经写事务提交，面板的写操作与命令行共用同一把锁、同一套实现；
  - 新建 Work 与 Task 的表单（第三轮稿：随填随变地显示领到的号、要写的文件和提交）；
  - Task 与 Work 的状态切换，切到 `done` 或 `shelved` 时释放租约；
  - Markdown 编辑：比对哈希；遇到他人未提交的改动按待决问题 8 处理；还在分支上维护的记录不给编辑入口；
  - 收件箱随之更新。
- 本片只在回环上开放写操作，并要求启动时的 CSRF 令牌；t13 再把写操作收到“可操作”级别。
- **非目标**：通知（t11）。
- **依赖**：t08、t09；待决问题 8。
- **验收场景**：
  1. 在产物页答两道题并提交：主工作区多一个只含一份答复文件的提交；另一个终端里挂着的 `nbdev answers --wait` 退出并拿到答复。
  2. 在产物 iframe 里伪造一道发布记录里没有的题号：外壳拒绝，不写文件。
  3. 在面板上新建 Work，同时在终端运行 `nbdev work new`：两边拿到不同的号，都通过 `governance:check`。
  4. 会话在终端里改了某 Task README 但没提交，开发者在面板上改同一个文件：面板给出差异并拒绝。
  5. 在面板上把某 Task 的状态改为 `done`：frontmatter 只改了 `status` 与 `updated`；这个 Task 的租约被释放。
  6. 打开一个“来自分支”的 Task：没有编辑入口。
- **验证**：包测试；typecheck；浏览器走一遍答复与新建；`governance:check`。
- **风险**：路径限定的提交会带走同一文件里他人的改动；表单脚本可能与产物页的样式冲突。

## t11 通知、会话消息与常驻

- **目标**：答复之后经 herdr 通知提问的会话；会话页能发消息与按键；面板可以常驻。
- **范围**：
  - herdr 适配层：socket 客户端与方法白名单，名单外的调用直接报错；事件订阅与对账；
  - 通知队列：followup 与 steer、投递前核对、输入行检查、指针消息、失败处理、`run/notify/` 记录、重启后现算；
  - 答复后自动排队；会话已更换时弹小窗；没有可通知的会话时列出其它持有租约的会话；
  - 会话页的输入框与按键按钮；审计 `~/.config/nbdev/audit.jsonl`；
  - 常驻：包脚本与用户级 systemd 单元文件；
  - 根 `AGENTS.md` 加 `[nbdev]` 一句；
  - 核实 Claude Code 的 steer 行为，核实前对 Claude 只给 followup。
- **非目标**：终端接管（t12）、跨设备（t13）。
- **依赖**：t07、t10；会话页与通知窗定稿；待决问题 9。
- **验收场景**：
  1. 开发者自己 herdr 里的 Claude 会话（正在工作）发布一道提问，开发者在面板上答复：会话变为空闲后几秒内收到 `[nbdev]` 开头的一行，并能照着读到答复。（开发者参与）
  2. 在 omp 会话里做同样的事，并选 steer：会话在工作中收到消息，并调整当前这一轮。（开发者参与）
  3. 提问的会话执行 `/clear` 之后再答复：不发，弹出“会话已更换”的小窗。
  4. 提问者是外部会话，或租约已失效：显示“答复已保存，没有可通知的会话”，并列出其它持有租约的会话。
  5. 关掉面板再打开：没发出的通知仍在队列里，最终发出。
  6. 适配层对 `pane.run`、`server.stop` 的调用直接报错，不到达 herdr（L3）。
  7. 会话 blocked 时：不发，继续排队，面板提示“会话在等确认”。
  8. 每发一次消息，审计里多一条。
- **验证**：
  - 包测试：L3 假 herdr，覆盖状态序列、身份变化与失败码；L4 在命名 herdr 会话里配一个假 Agent 脚本，按调研的做法；
  - typecheck；
  - 开发者在真实会话上的观察，写进 Task；
  - `governance:check`；`docs:check`（`AGENTS.md` 改动）。
- **风险**：Claude 的确认界面被误判为 idle；消息打进半截输入；先查后发之间有竞争窗口（见调研第四节）；排队依赖面板常驻。
- **需要开发者授权或决定**：根 `AGENTS.md` 的改动；向开发者的真实会话投递消息的验收；安装 systemd 单元（决定 9 已允许，安装时确认）；建立 `~/.config/nbdev/`。

## t12 herdr 网页终端

- **目标**：在面板里看会话的实时终端，接管键盘输入，离开时交还控制权。
- **范围**：
  - xterm.js；每个连接一个 observe 子进程；
  - 接管：`control --takeover`、resize、`terminal.input`、release；
  - 按键按钮；手机的纯文本视图（`agent.read --source recent-unwrapped`）；接管前的提示；审计。
- **非目标**：鼠标事件；在面板里启动新会话。
- **依赖**：t09、t11（适配层与审计）；会话页定稿。
- **验收场景**：
  1. 两个浏览器同时看同一个 pane：在 pane 里输入后，两边都在约 20 毫秒内更新，herdr 那边的尺寸不变。
  2. 一边点接管：终端尺寸变成网页的列数与行数（在 pane 里用 `stty size` 可见）；另一个控制者收到“被接管”的提示。
  3. 关闭接管的标签页：控制权释放，herdr TUI 能重新操作。
  4. 接管状态下输入中文、点 Esc 与 Ctrl+C 按钮：会话收到对应的输入。
  5. 390px 视口下，纯文本视图可读，输入框能发送。
- **验证**：
  - 包测试：L3 子进程桥接；L4 在命名 herdr 会话里跑 bash，验证 observe、control、release；
  - 浏览器按“窄屏布局”档追加 390px 视口；
  - 开发者在真实 pane 上接管一次。（开发者参与）
- **风险**：TUI 与网页来回改尺寸；浏览器吞键；手机输入法；帧里不带应用的终端模式。

## t13 跨设备访问

- **目标**：手机等设备经 Tailscale Serve 安全地使用面板。
- **范围**：
  - 设备配对、令牌、分级、吊销、有效期（待决问题 11）；
  - 把 t10 到 t12 的写操作与终端操作收到“可操作”级别；回环请求同样要登录；
  - 去掉对转发头的拒绝；
  - Tailscale Serve 两个端口的配置说明与检查命令；手机布局。
- **非目标**：面板自带 TLS 的局域网直连；Tailscale funnel。
- **依赖**：t10 到 t12；待决问题 11。
- **验收场景**：
  1. 未配对的设备经 tailnet 打开面板：只看到配对页。
  2. 配对码 5 分钟后失效，用过一次也失效。
  3. “只看”设备发出答复或接管请求：由服务端拒绝，而不只是按钮隐藏。
  4. 吊销某台设备后，它的下一次请求被拒。
  5. 在手机上打开一份产物（产物来源经 tailnet 的第二个端口）、答一道题，通知送达会话。（开发者参与）
  6. 把面板配置成绑 `0.0.0.0`：拒绝启动。
- **验证**：包测试（登录与分级、CSRF、`Origin`、令牌过期）；浏览器在 390px 视口下走一遍；开发者用手机走一遍。
- **风险**：Tailscale Serve 配错会把服务暴露到公网，因此只用 serve，不用 funnel；证书与主机名会变化。
- **需要开发者授权或决定**：Tailscale Serve 的配置（会改变网络暴露面）；设备有效期与手机的缺省级别。

## t14 运行登记、开发服务与现场补充

- **目标**：命令行接管开发服务、建 worktree 与截图这几件固定做法；面板“现场”补上在跑的进程、checkout 与 GitHub 只读视图。
- **范围**：
  - `dev start`、`dev stop`、`dev status`：前台监管，日志直接写文件，打印 `READY <url>`，同一 checkout 复用，默认不停别人起的，核对 PID 与启动时间；
  - `worktree new <workId> <taskId>`：按规则命名，用 `/usr/bin/git`，写入 `home` 提示；
  - `find`；`shot` 只做薄包装；
  - 面板：“在跑”显示数量与入口，含“无主”的运行；checkout 列表；GitHub 只读（`gh pr list`、`gh issue list`）。
- **非目标**：`review start`（第二版）；GitHub 写操作；“治理文件落后 master”的提示（第二版）。
- **依赖**：命令行部分依赖 t06、t07，面板部分依赖 t09；待决问题 12、14。
- **验收场景**：
  1. 两个会话先后在同一 checkout 运行 `dev start`：第二个拿到 `reused: true` 与同一个地址。
  2. 另一个会话运行 `dev stop` 停不了它，退出码 3；加 `--force` 才能停，并在输出里写明属主。
  3. 进程被外部杀掉、PID 被复用：`dev status` 标为已结束，`dev stop` 不发信号。
  4. `worktree new w00022 t06` 建出 `.worktree/w00022-t06-…` 与 `feat/w00022-t06-…`；路径已被占用时退出码 3，不自动改名。
  5. 面板的 GitHub 页列出开着的 PR 与检查结果，没有任何写按钮。
- **验证**：包测试（L4 用会打印就绪行的假开发脚本）；typecheck；浏览器走一遍“现场”。
- **风险**：各分支开发服务的就绪行格式不同；omp 会不会拦截子进程里的 `git worktree add` 未实测，命令行一律用 `/usr/bin/git`。

## 需要开发者授权或决定的点

| 点 | 所在 Task | 性质 |
|---|---|---|
| Proposal 从 draft 改为 accepted，定开工前的待决问题 | 全部之前 | 产品与范围决定 |
| 新包登记（`workspaces`、根 devDependencies、`packages/AGENTS.md`、Monorepo 边界） | t06 | 跨模块登记 |
| CI 矩阵与 `.github/workflows/workspace-packages.yml` | t06 | 交付配置，开发者决定是否纳入 |
| 编号规则切换（Work 规则、`.agents/works/AGENTS.md`），以及规则文件是否算记录 | t06 合入时 | 决定 6 已定同一次切换，规则文件的归类待定 |
| 写入用户级入口 `~/.local/bin/nbdev` | t06 | 用户级文件 |
| 在真实仓库第一次用 `nbdev` 建 Work、导入编号 | t06 | 写 `master` |
| 首页 Work 区用卡片还是表；面板前端技术 | t09 之前 | 界面与技术决定 |
| 根 `AGENTS.md` 加 `[nbdev]` 一句 | t11 | 规则改动 |
| 安装用户级 systemd 服务 | t11 | 决定 9 已允许，安装时确认 |
| 建立 `~/.config/nbdev/`（审计、设备表） | t11、t13 | 用户级目录 |
| 向开发者的真实会话投递消息、接管真实 pane 的验收 | t11、t12 | 开发者参与 |
| Tailscale Serve 配置 | t13 | 改变网络暴露面 |
| 每片合入 `master` | 每片 | 合并需授权 |

依赖安装（xterm.js、`proper-lockfile`、Vue 与 Vite）、本地提交、聚焦测试与命名 herdr 会话里的测试，都属于本地可逆操作，按 P-005 不再逐项询问。

## 不在本计划内

- 替其它会话迁移记录（t05，按开发者授权逐条做）。
- herdr server 升级与鼠标事件；面板自带 TLS 的局域网直连；结构化会话与读会话 jsonl；在面板里启动新会话。
- 产物页的 Vue 与 nb-ui 组件（w00017 合入后再做）；“治理文件落后 master”的提示；GitHub 写操作；`review start`。
