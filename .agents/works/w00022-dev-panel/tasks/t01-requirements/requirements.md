# 需求分析与功能分析：开发者项目面板与本地／入库边界

2026-10-12 起草，交开发者确认。数字是当天在本机量的；“从代码推断”的地方单独标出。

## 一、现状：东西散在哪里

| 东西 | 在哪里 | 规模（2026-10-12） |
|---|---|---|
| checkout | 主工作区加 `.worktree/` 下 10 个 worktree | 12 个本地分支；t80 一件事就开了 4 个（代码、草稿、审查、t81） |
| Work 与 Task 记录 | 各 checkout 的 `.agents/works/`；进度只在实现分支维护，主工作区只有占号副本 | 主工作区 24 个 Work；w00017 分支 `.agents` 1711 个文件 |
| 证据 | 各 Task 的 `evidences/`、`walkthroughs/`，入库 | w00017 分支 `.agents` 共 45.9 MB：PNG 227 张 27.7 MB、txt 382 个 5.6 MB、json 169 个 2.7 MB；`evidences/` 下 989 个文件 |
| 设计讨论 | `.local/design-review/<Task>/` 的 HTML 评审板与截图 | 95 MB（t80、t81 当天的截图；若按旧做法入库，仓库就多 95 MB） |
| Agent 给开发者看的本地产物 | `.local/artifacts/`（日期前缀的 HTML） | 1 个文件；与 `design-review/` 是两处同类东西 |
| 用户本地资产 | `.local/` 其余目录：数据集、书籍、品牌、看板娘、实验 | 共约 1.6 GB，用户自管 |
| 审查与子代理的原始记录 | 会话临时目录 `/tmp/claude-1000/<项目>/<会话>/scratchpad/`：omp 会话、审查报告、开发服务日志、探针脚本 | 本会话 36 MB；同项目 83 个会话目录；重启或清理 `/tmp` 就丢 |
| 后台进程 | 开发服务（端口成组顺延）、omp、Playwright、子代理 | 没有地方列出来；靠 `ps` 与各自报告里的 PID |
| Issue、PR | GitHub | 只能经 `gh` 或网页看 |

规则上的矛盾：`.local/README.md` 写着“Agent 通常不得读写 `.local/`，只有 `.local/artifacts/` 例外”，而 2026-10-12 新建的 `design-review` Skill 让 Agent 写 `.local/design-review/`。

## 二、问题

1. **找东西要先知道它在哪**：同一件事的记录、草稿、报告、截图分在不同 worktree、分支、`.local`、`/tmp`。例：t81 的 Task 记录建在 t80 分支上，开工时要搬到 t81 分支；omp 审查报告在会话临时目录里。
2. **看不到整体进度**：哪些 Task 在做、哪些在等我、哪个 worktree 被谁占着、哪个分支领先或落后主线，要逐个打开 README、跑 `git log`。
3. **沟通只有一条窄通道**：会话窗口只能发文字和文件路径；对比、标注、表单要开发者自己打开文件；开发者的选择只能打字回来。
4. **仓库变大**：截图与测试原始输出按“证据”入库，w00017 分支 `.agents` 已 45.9 MB，主要是截图。
5. **规则互相矛盾**：见上节末；Agent 的本地产物有 `artifacts/`、`design-review/` 两处。
6. **会丢的东西放在会丢的地方**：omp 会话、审查报告、开发服务日志在 `/tmp`，审查跑到一半机器重启就没了。
7. **后台进程看不见**：开发服务占哪个端口、omp 跑了多久、谁的 Playwright 在跑，只能问 Agent 或查 `ps`。
8. **编号会撞**：Work 编号靠“唯一分配者”人工协调（[Work 规则](../../../../works/README.md#编号分配与记录位置)），Task 编号更是各分支各自往下数。实例：t80、t81 只登记在 t80 分支上，主线 w00017 分支上的 Task 表里没有它们；同时在主线做 t79 的会话，下一个 Task 很可能也取名 t80。现在只能靠人提醒。
9. **Agent 每次都重新摸索做法**：建 worktree（要用 `/usr/bin/git` 绕开 omp 接管）、起开发服务（端口成组顺延、要记 PID、日志要落盘）、起 omp 审查（stdin 要重定向、会话目录放哪、报告只追加）……这些都写在规则里，靠每个 Agent 读懂后手工照做，今天的子代理也各自写了截图脚本。

## 三、参与者

- **开发者**（唯一的人）：找文件、看进度、审设计与审查报告、拍板、填表。
- **主 Agent**（Claude Code 会话、omp 会话）：调度、写文档、发布讲解页、读回答。可能同时有几个会话（今天另一个会话在做 t79）。
- **子代理、omp 编码与审查**：产出代码、报告、截图、日志。

## 四、使用场景

1. **一眼看全局**：打开面板，看到每个 checkout 的分支、对应的 Work 与 Task、未提交文件数、相对主线领先落后、是否有进程在用它；进行中的 Task；“等我处理”的事（没答复的讲解页、待定的决定、待批准的回写建议）。
2. **找文件**：搜“t81”或文件名，跨所有 checkout 命中；打开渲染好的 Markdown，相对链接能点、图片能看。
3. **审设计**：Agent 发来一页讲解（候选并排、推荐、标注），我在页面上选、写备注、提交；回会话说“填好了”。
4. **审报告**：omp 的审查报告按条目显示，我逐条标“改”“不改”“要讨论”。
5. **看后台**：哪些开发服务在跑（端口、PID、属于哪个 worktree）、omp 跑了多久、日志是否还在增长；一键打开 Lab 地址。
6. **看一次交付**：某个 Task 的提交、diff、验证结果、截图集中在一页。
7. **Agent 发布与读回**：Agent 把页面写到约定目录，用平台提供的组件；读回开发者提交的答案。
8. **Agent 用命令行做同样的事**：开发者用网页，Agent 用命令行。Agent 领一个 Work 或 Task 编号、建 worktree、起开发服务、发布讲解页、读答案、查“谁在跑什么”，都是一条命令，结果有给人看的文字和给程序读的 JSON 两种。

## 五、本地与入库的边界

### 判据（提议）

一件东西进 Git，当且仅当它会约束别人（人或 Agent）之后的行为，或丢了就无法重现：

| 进 Git | 留本地 |
|---|---|
| 代码、测试、脚本、配置 | 能重新生成的：截图、构建产物、测试与检查的原始输出、日志 |
| Spec、ADR、Proposal、规范、Skill | 讨论过程：草稿、对比图、讲解页、表单答案 |
| Work、Task 的范围、授权、**决定**、当前状态、验证结论（命令与结果的文字摘要） | 会话与审查的原始记录：omp 会话、子代理报告原文、审查报告原文 |
| 不可重现且必须留的原始数据（例如一次性测量的数值），写成小的文本文件 | 大体量数据、用户素材 |

配套规则：

- **决定以文字入库**：讲解页、表单答案只是讨论材料；开发者的决定由 Agent 摘成文字写进 Task README（今天 t80 已经这样做）。
- **验证以摘要入库**：Task 里写“跑了什么命令、多少通过、失败原文”，原始输出留本地；只有不可重现的测量才把数值入库。
- **截图默认不入库**，包括验收截图；开发者要求时例外。
- **已经入库的不动**：历史里的截图删了也不会让仓库变小，不改写历史；新规则从现在起生效。

### Work 分两类（开发者 2026-10-12 定）

| | 仓库 Work | 本地 Work |
|---|---|---|
| README 与 Task 在哪 | `.agents/works/<workId>/`，入库 | `.local/agent/works/<workId>/`，不入库 |
| 本地产物在哪 | `.local/agent/works/<workId>/` | 同左（整个 Work 都在这里） |
| 适合 | 会改代码、规范或长期行为的工作 | 探索、spike、一次性的调查或讨论 |
| 规则 | 同一套 Work 规范：README 的写法、Task 的写法、授权与快照 | 同左 |

- **同一个编号空间**：两类 Work 都从登记表领号，本地 Work 不会和仓库 Work 撞号。
- **本地 Work 可以转入仓库**：把 README 与 Task 搬进 `.agents/works/`，编号不变，本地产物留在原处。
- 面板与命令行同时索引两类，标出是哪一类。

### 本地目录怎么分

把 Agent 管的和用户管的分开，Agent 管的部分按 Work 与 Task 组织，两类 Work 用同一套布局，面板只索引这一块：

```text
.local/                          # git 忽略
├── README.md                    # 唯一入库的文件，写清两块的规则
├── agent/                       # Agent 管：可读写
│   ├── registry.json            # 编号登记表
│   └── works/<workId>/
│       ├── README.md            # 只有本地 Work 才有
│       └── tasks/<taskId>/
│           ├── README.md        # 只有本地 Work 才有
│           ├── review/          # 讲解页与评审板（原 .local/design-review/<Task>/）
│           ├── answers/         # 开发者在面板上提交的答案，只追加
│           ├── reports/         # 子代理、omp 的报告原文
│           ├── shots/           # 截图
│           └── logs/            # 测试原始输出、开发服务日志
└── <用户的目录>/                 # 用户管：Agent 只在用户要求时碰
```

- `.local/artifacts/`、`.local/design-review/` 并入 `.local/agent/`。
- omp 的会话目录、审查报告、开发服务日志从会话临时目录改到 `.local/agent/works/<Work>/tasks/<Task>/`，不再随 `/tmp` 丢失（会话临时目录只放一次性脚本）。
- 草稿 worktree、审查 worktree 照旧在 `.worktree/`，面板从 `git worktree list` 读到它们。

## 六、功能分析

### 模块

| 模块 | 做什么 | 数据从哪来 |
|---|---|---|
| 索引 | 列出 checkout、分支、Work 与 Task、Spec 与 Proposal、本地 Agent 产物 | `git worktree list --porcelain`、`git status`、`git rev-list --count`；各 checkout 的 `.agents/works/**/README.md`；`docs/specs/README.md` 与各 Spec 的 frontmatter；`.local/agent/` |
| 浏览与搜索 | 跨 checkout 打开 Markdown、HTML、图片、源码（只读）；全局搜索；按 Task 聚合一页（README、计划、提交、讲解页、报告） | 文件系统；ripgrep；`git log` |
| 讲解页平台 | Agent 写的 `.vue` 或 `.html` 页面在面板里渲染；平台提供 Vue、nb-ui、UnoCSS 与一小套讲解组件：候选对比、决策卡（选项、推荐、开发者的选择）、标注图、表单、diff、截图画廊 | `.local/agent/**/review/` |
| 回复通道 | 页面里的表单提交后写成 `answers/<页面>/<时间>.json`（只追加，不覆盖）；首页“等我处理”列出没答复的页面 | `.local/agent/**/answers/` |
| 运行状态（第二版） | 开发服务、omp、Playwright 进程：属于哪个 checkout、端口、跑了多久、日志是否在增长 | `ps`、进程工作目录、`.local/agent/**/logs/` |
| GitHub（第二版） | Issue、PR、CI 状态，只读 | `gh` |

### 约束

- **只读仓库**：面板不改任何被 Git 跟踪的文件，只写 `.local/agent/` 下的答案；改文档、提交仍由 Agent 在会话里做，避免和 Agent 的改动冲突。
- **只在本机**：只监听 `127.0.0.1`，不做账号；讲解页里的脚本视同仓库代码，按受信对待。
- **不依赖某个分支的状态**：放在 `master`，读所有 checkout；某个分支的产品代码坏了不影响面板。
- **不是第二个真相源**：面板显示的状态都从 Git 与文件系统现读；决定只认 Task README 与 Spec。
- **Task 状态先不解析**：README 里是自由文字，第一版直接渲染 README，不从文字里推算状态；要汇总状态，需要先给 Task 的 frontmatter 加机器可读字段，属于治理规则改动，放到后面再定。
- **中文界面**，外观用 nb-ui。

### 不做

- 不替代 Git、编辑器或 GitHub 网页；第一版不在面板里编辑文档。
- 不远程访问、不多人使用。
- 不读 Claude Code、omp 的会话内容（只看进程与日志文件是否在增长）。

## 七、Agent 用的命令行

开发者用网页，Agent 用命令行，两者共用同一个核心库：索引、编号登记、答案、进程登记都在核心库里，网页服务与命令行只是两个入口；命令行不依赖网页服务在跑，直接读写同样的文件。

### 编号登记

- **登记表**：放在主仓库根的 `.local/agent/registry.json`（所有 worktree 共用同一个主仓库根，所以是同一份），加文件锁，领号是“读最大值、加一、写回”的原子操作。
- **领号时同时核对现状**：扫描所有 checkout 与本地分支里的 `.agents/works/`，登记表与仓库里任何一处已用的号都不再发；发现两处同号时报告冲突，不自动改名。
- **记下归属**：每个号记下标题、哪个会话或 Agent 领的、在哪个分支或 worktree 执行、领号时间；网页上能看到“这个号在哪”。
- **Task 号也走登记表**：按 Work 分别递增，解决“各分支各自往下数”。
- 已知限制：登记表在本机，多台机器之间仍要人协调；现在只有一台机器。

### 命令（第一版候选）

| 命令 | 做什么 | 取代的手工步骤 |
|---|---|---|
| `status` | 全局概况：checkout、分支、Task、等开发者处理的事、在跑的进程 | 逐个看 README、`git log`、`ps` |
| `find <词>` | 跨 checkout 搜文件名与内容 | 记住东西在哪个 worktree |
| `work new`、`task new` | 领号并建出最小的 README | 人工查号、占号 |
| `worktree new <Task>` | 按命名规则建 worktree 与分支、装依赖、登记归属 | 记住 `/usr/bin/git`、命名规则、`prox bun install` |
| `dev start`、`dev stop` | 在某个 worktree 起开发服务，日志写 `.local/agent/`，登记端口与 PID；按登记停掉 | 记 PID、读日志找端口、不能 `pkill -f` |
| `page publish`、`answers` | 发布讲解页（登记到“等开发者处理”）；读答案、标为已读 | 告诉开发者文件路径、等开发者打字 |
| `shot` | 按约定截 Lab 场景，存到 `.local/agent/works/<Work>/tasks/<Task>/shots/` | 每个子代理各写一份截图脚本 |
| `review start`（第二版） | 按约定起 omp 审查：stdin 重定向、会话目录与报告放 `.local/agent/`、报告只追加 | 照规则手工拼 omp 命令 |

每个命令都有 `--json`。命令行同样只读被 Git 跟踪的文件，`work new`、`task new` 这类建 README 的除外；提交仍由 Agent 自己做。

## 八、开发者的确认

2026-10-12 开发者全部确认下列七条，并补充：Work 分仓库与本地两类，两类复用同一套 Work 规范（见第五节）。

1. 第五节的判据与本地目录的分法；`.local/artifacts/`、`.local/design-review/` 并入 `.local/agent/`；omp 会话与报告改放 `.local/agent/`。
2. 验证结果只以文字摘要入库、原始输出留本地；验收截图默认不入库。
3. 面板第一版的范围：索引、浏览与搜索、讲解页平台、回复通道；运行状态与 GitHub 放第二版。
4. 面板只读仓库、只写 `.local/agent/` 下的答案。
5. 位置：`packages/dev-panel`，或仓库根目录的独立目录。（更正：根 `package.json` 的 `workspaces` 是逐项列出的，两个位置都要登记进去才能依赖 nb-ui，差别比原先写的小，见 [补充分析](analysis-supplement.md) 第九节。）主 Agent 推荐前者。
6. 命令行与网页共用核心库；编号登记表放 `.local/agent/registry.json`，Work 与 Task 号都走它；第一版的命令按第七节的表，`review start` 放第二版。
7. 有了登记表之后，Work 规则里“唯一分配者人工协调”那一节改成“经命令行领号”；Task 号也必须经它领。
