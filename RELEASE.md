# 更新日志

这里只放当前版本。更早的版本见 [docs/changelog/](docs/changelog/)。

## Unreleased - 2026-07-27 文生图六项修复（text-to-picture 分支）

### 用户可见变化

- 正文里 AI 生成的插图现在能在编辑器里直接显示了（此前所有项目内图片都是裂图）。
- 已生成的插图支持重新生成：在历史图片详情点"还原为占位块并重新生成"；正文被改过、固定 seed、图片被复制多处等情况会在改动正文前明确拒绝并说明原因。
- 生成失败/已取消的插图占位块不再永久卡死，可以直接再点"生成图片"。
- 角色视觉迁移面板回到文生图分页：角色详情页生成 tag 后可以继续完成解析、逐项确认与应用。
- 新项目第一次点"正文生图"不再报"尚未保存文生图 Recipe"：默认 Recipe 会自动落盘。
- 插图规划失败后再点"正文生图"不再假装"已启动"：可重试的会自动重试，不可重试的会明确提示去"重新规划"。
- 修复生产环境所有插图任务必然失败的问题（内部 HTTP 客户端参数错位，任务全部落"结果未知"）。

## Unreleased - 2026-07-24 文生图多画风串、Recipe 自动保存与插图导演修复

### 用户可见变化

- 文生图分页新增多画风串管理：每个 Recipe 可维护多个画风串，通过下拉选择器切换；支持新建、复制、删除，只有一个画风串时禁止删除。
- Recipe 现在自动保存到 Project 文件系统中的 `text-to-image-recipe.md`，不再需要手动操作"保存"按钮。始终保存当前最新状态，只有一个 Recipe 时没有恢复歧义。
- 修复 `illustration.director` 绑定在设置页无法选择模型的问题：服务端现在接受 `workspace/<slug>` 格式的 Project Path，Recipe 默认路由正确返回。
- 精简文生图分页文案："保存为唯一 NovelAI Provider"改为"保存"，"重新检测连接"改为"检测"，移除多余说明性文字，页面视觉更紧凑。

### 验证

- 聚焦测试：store 5、codec 5、service 9、migration 4、compiler 6，合计 29 项全部通过。
- 全量 TypeScript typecheck exit 0。
- 编译器测试夹具从 Recipe v2 升级到 v3，schema 与生产代码保持一致。
## Unreleased - 2026-07-22 Agent Session 与文生图路径修复

### 用户可见修复

- 修复 Windows Portable 无法新建 Agent Session：State Root 的 `\\?\C:\...` 长路径前缀不会再被转换成 Bun 无法解析的 `file://%3F\C:\...`，Profile、Agent Variable 与 World Engine 共用的 runtime artifact 导入边界同时受保护。
- 修复插图 Workflow、Project overlay、角色视觉与 Recipe 把 Project Path 错解析到整个 Workspace Root 的问题；Project-local 文件现在固定落在对应 Project Workspace。
- 修复 Storyboard 全局导入/发布把 Global Profile Home 解析成 `null` 的问题，并移除相关 `as any` 绕过；缺失的 Workspace Root `.nbook` 会由 Profile Home 边界安全创建。
- 修复 Workspace History 在 Windows Portable 中自行拼接 namespace SQLite URL、导致历史收件箱返回 500 的问题；vendor 数据库入口现在与应用 SQLite、runtime artifact 共用同一条本地文件 URL 规范化边界。

### 验证

- 路径、runtime artifact、SQLite/Prisma 环境、Profile Home、Project overlay、Storyboard、文生图消费者与 Workspace History 共 95 项聚焦测试通过，1 项跳过；完整 TypeScript typecheck exit 0。
- 完整 Nuxt/Nitro build、Product stage、Tauri release 与 Portable assemble 均 exit 0；客户端 runtime boundary 扫描 74 个 JavaScript 文件通过。
- 最终 Portable 真实启动后，Prisma migration 与 assets sync 均 exit 0；首页和动态入口模块返回 200，真实创建 `leader.default` Agent Session、读取 recovery、Workspace History inbox 与插图 Workflow 均返回 200。
- 最终运行日志复核 42 条请求/运行记录无 error，模型配置快照仍为 Provider API 缺失 0、模型 API 缺失 0、API validation issue 0。

## Unreleased - 2026-07-22 旧模型配置迁移修复

### 用户可见修复

- 旧版模型配置不再要求逐个补填“Provider 默认 Pi API”：产品加载时会把旧运行时实际采用的 `openai-completions` 默认值显式写入内存快照，并补到 API 仍为空的模型。
- 已有非空 Provider/模型 API 不会被覆盖；无效非空值不会被静默改写。后续正常保存会把显式字段持久化，runtime 继续只消费模型自己的 API。

### 验证

- TDD 红灯复现成功；迁移归一化 16 项通过，模型配置聚焦回归 6 个文件、51 项通过，全量 TypeScript typecheck exit 0。
- Config Service 全文件测试受当前 Windows 文件符号链接 EPERM 阻断，57 项均未进入业务断言；最终 Product 将通过真实配置快照与启动 smoke 验证替代该环境失败路径。
- 完整 Nuxt/Nitro build、Product stage、Tauri release、Portable assemble 与包内 Prisma deploy 均 exit 0；客户端边界扫描 74 个 JavaScript 文件通过。
- 最终 EXE 读取真实旧配置时，5 个 Provider 和 13 个模型的 API 缺失数均为 0，相关 validation issue 为 0；首页和动态入口模块均返回 200。

## Unreleased - 2026-07-22 模型设置修复

### 用户可见修复

- 修复模型配置页在旧配置上持续提示“缺少 Pi API”的问题：当 Provider 已明确选择受支持的默认 Pi API 时，“一键修复”会把它补到该 Provider 下 API 仍为空白的已有模型。
- 已有非空模型 API 不会被覆盖；重复 ID、无效接口和无法确定的协议不会被猜测。补全接口后继续使用 Model Library 修复已知模型能力，用户检查草稿后再保存。

### 验证

- 本次模型 API 改动的 2 个测试文件、16 项测试通过；扩展相关回归 5 个文件、28 项测试通过。
- 全量 TypeScript typecheck exit 0；完整 Nuxt Product build exit 0；客户端边界扫描 74 个 JavaScript 文件通过。
- Windows Product stage、Tauri release 编译与 Portable assemble 均 exit 0；最终包内 Prisma deploy exit 0，EXE 启动后首页与入口 JavaScript 均返回 200。
- 已知无关测试：额外纳入 `shared/dto/config.dto.test.ts` 时，其“拒绝顶层 NovelAI Recipe 数据”断言失败；当前 schema 会剥离未知字段而不是抛错，本轮未更改该 DTO 合同。

## Unreleased - 2026-07-22 Windows Desktop 修复

### 用户可见修复

- Windows Portable 启动时会先规范化 `\\?\C:\...` 形式的 State Root，避免 SQLite URL 被错误转换成 `file://?/C:/...`，数据库迁移不再因此失败。
- 修复文生图页面分块把 Node 专用 `node:crypto` 带入 WebView 的问题。共享合同哈希保持原有同步 SHA-256 结果，改为浏览器与服务端均可运行的实现。
- NovelAI Provider 继续在文生图分页内直接编辑；本轮重新打包会包含此前已确认的输入位置调整。

### 构建防回归与验证

- Nuxt 构建现在会解析全部客户端模块说明符，只要 `_nuxt` 产物含 `node:` built-in 就立即失败，不再生成“文件能下载但 WebView 无法执行”的坏包。
- 聚焦回归：5 个测试文件，34 项通过、1 项 Windows/平台条件跳过；全量 TypeScript typecheck exit 0。
- 完整 Nuxt Product build exit 0；客户端边界守卫扫描 74 个 JavaScript 文件通过。Product stage、Tauri release 编译和两次最终 assemble 均 exit 0；`dist/NeuroBook.exe` 启动后迁移 exit 0、根页面与入口 JS 均返回 200。

## 0.9.0-canary - 待发布

这一版把 AI 助手从「一问一答」变成了「能接整活儿」：写正文、逐条挑毛病、按意见改稿这一整套流程，现在可以打包成一条命令交给它，跑的时候还能看进度、随时叫停。另外新增了 NeuroBook 账号和云备份，文档站上线了英文版。

### 新功能

**让 AI 跑完一整套写作流程**

新增「工作流」——把多个步骤打包成一条命令，AI 会一步步跑完，不用你在旁边一句句催。内置四条新流程：整章的「写 → 审 → 改」循环、跨章节一致性检查、拆书分析（把一本书按章拆开，逐章看钩子和爽点）、角色 200 问批量深挖。AI 想启动工作流要先问过你；你也可以自己发起。

**顶栏多了「任务」面板**

工作流在后台跑，不占着聊天窗口。顶栏图标会显示当前有几个在跑，点开能看每个任务的进度、取消它、复制结果、清掉已经完成的。聊天里也会出现一张卡片，实时显示流程走到了哪一步。

**写作助手从 15 个精简到 9 个**

原来的助手（技能）名字长、职责碎，得自己记住该按什么顺序用。现在开新书用一个 `novel-setup` 就走完「建项目 → 写世界设定 → 立角色 → 铺时间线」；写正文用一个 `novel-writing` 就走完「规划 → 写 → 改」。不知道该用哪个，看 `novel-guide`，它是整条写作路线的地图，AI 每次开工都会先读它。

**查小说榜单**

设置里新增「小说数据」，填一个地址之后，AI 就能查榜单和单本书的详情，用来做选题参考。查到的数据带抓取时间，太旧会标出来。

**NeuroBook 账号与云备份**

设置里新增「NeuroBook 账号」，用设备码关联官网账号后，可以把本地实例备份到云端。

两点要先说清楚：备份的是**整个实例**，里面包含配置文件中的 API 密钥，不只是你的稿子；恢复目前也**不是一键完成**的——下载的备份会解压到一个临时目录，需要你先停掉服务再手动替换过去。

**看得见 AI 的上下文里装了什么**

聊天输入框上方那个用量条现在能点开了，打开的是一个可以和聊天并排摆着的浮动窗口，两个标签页：

- **组成**：这一轮发给模型的内容由哪几块构成、各占多少 token，能一层层展开到「具体哪个文件占了多少」。自动压缩会在什么位置触发也标出来了。
- **缓存**：最近几次请求命中缓存的情况，以及没命中的原因，比如「距上次请求 12 分钟，超过 5 分钟的保留期，前缀缓存已过期」。

面板只陈述观察到的现象和原因，不对你下指令。「缓存数据没上报」和「命中率 0%」会分开显示——这两件事在诊断上完全不同。旧会话也能看，只是第一轮里有部分内容分不出类别，面板顶部会说明这一点。

**文档站有英文版了**

文档站新增 12 个页面，覆盖世界引擎、剧情工作台、Markdown 编辑器、llmlint、工作流、AI 的三种模式、运维、设置中心、配色、文件变更历史、账号与备份。首页按「创意写作 IDE」重写，加了站内搜索和 4 张流程图，全站同时提供英文版。

### 改进

- 书架打开明显变快，因为不再实时统计卷数、章节数、字数和设定条目数。**代价是这些数字暂时从书架上消失了**，改成显示简介。
- 带依赖的插件（比如 llmlint）不会再每次启动都被清空重装，插件列表现在也显示版本号。llmlint 升到 2.0.1。
- 编译产物有了硬上限：每个工作区最多占 512 MB，超了自动清理最旧的。在开发机上这一轮一次性回收了 17.34 GB。

### 修复

- AI 执行命令时设的超时终于真的生效了。以前设 30 秒，实际可能一直跑到 5 分钟。
- 缓存命中率之前算错了：分母漏掉了「写入缓存」的那部分，而且用的是整个会话的累计值——第一轮要把全部内容写进缓存，会永久性地把这个数字压低，导致后面看到的读数没有参考价值。现在全应用统一口径。
- Windows 便携版关掉命令行窗口后不会再残留进程占着端口，下次启动不会因为「端口被占用」失败。
- 修复了内置 AI 配置在某些情况下整个编译中断的问题。

### 升级须知

- 本版本不需要迁移数据，配置文件和数据库格式没有变化。
- 这一版的新功能大多还没做过完整的人工验收（工作流、账号与云备份、上下文检查面板、文档站英文版尤其如此），建议先在不重要的项目上试。
