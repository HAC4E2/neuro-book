---
name: novel-genre-research
description: 题材分析、竞品分析与写作调研。用 novel_rankings / novel_book_detail 查询本地 novel-api 缓存的起点、番茄榜单与书籍详情做选题；对标作品经 Tomato Novel Downloader + novel-import-tomato-reference 导入后，用 book-deconstruct workflow 拆书分析。用于分析某个题材的市场惯例与读者期待、拆解对标作品、为选题或转型提供参考。
when_to_use: 用户想看榜单选题材、分析某个题材怎么写、找对标作品、拆解一本书的结构与卖点、做选题调研时。
---

# novel-genre-research：题材与竞品调研

围绕「榜单选题 → 对标发现 → 拿到文本 → 拆书分析 → 结论落地」的完整调研流程。每一步都基于真实数据或已导入素材，做不到的部分向用户明确说明并给替代路径，不要伪造数据。

## 1. 榜单选题（novel-api）

用 `novel_rankings` / `novel_book_detail` 工具查询本地 novel-api 榜单服务：

- `novel_rankings`：查平台最新榜单快照。platform 取 `qidian` / `fanqie`；board 是榜单键——起点为 `yuepiao`（月票）/ `hotsales`（畅销）/ `recom`（推荐）/ `collect`（收藏），番茄是形如 `0_1_1139` 的机器键。
- `novel_book_detail`：按平台书号（榜单条目里的「书号」/ externalBookId）查书籍详情：简介、分类、状态、字数。
- 选题分析套路：先拉 1-2 个与用户方向相关的榜单，对头部作品用 `novel_book_detail` 补简介与分类，再归纳题材分布、书名/简介的钩子模式、连载状态与字数区间，落成「这个题材现在市场上怎么打」的观察。

**数据边界（必须向用户交代）**：

- 数据来自本地 novel-api 缓存，不是实时抓取：榜单是最近一次采集的快照（工具会返回快照时间），书籍详情缓存 TTL 3 小时。
- 详情返回里若标注「数据可能过期(stale)」，必须原样向用户转述，不要当作新鲜数据。
- 起点榜单条目当前没有数值 metrics（字体反爬导致数字无法还原），只有书名、作者、书号；不要编造阅读量或销量。
- 榜单没有快照、服务未配置或未启动时，工具会报中文错误。此时用人话引导用户：到设置页「小说数据」面板配置服务地址（默认 http://localhost:3000）；服务本体在 sibling 仓 `../novel-api`，按其 README 启动。不要伪造榜单内容顶替。

## 2. 对标发现 → 拿到文本

榜单/讨论中锁定对标作品后，引导用户拿到全文文本：

- 番茄免费作品：让用户用 Tomato Novel Downloader（Web UI 搜索、首次下载）拿到 epub 或下载目录，细节见 `novel-import-tomato-reference` skill 的 `serve` 封装。
- 用户已有 epub / 下载目录时跳过下载，直接进导入。

## 3. 导入（novel-import-tomato-reference）

用 `novel-import-tomato-reference` skill 把文本导入当前小说 Project Workspace 的 `reference/tomato/{book}/`（生成 `metadata.json`、`chapters/`、`full.md`）。不写入 `manuscript/`，外部素材不混进原创正文。

## 4. 拆书分析（book-deconstruct workflow）

对已导入的书用 `run_workflow` 跑 `book-deconstruct` 拆书：

- 参数：`book` = 导入目录（如 `reference/tomato/{book}`）、`maxChapters` = 拆解章数上限、`focus` = 本次拆书关注点（如「开篇钩子与承诺」「节奏与爽点分布」）。
- workflow 默认走后台任务，结果会以后续消息回流；不要空转轮询。
- 在拆书产出上做人工分析：钩子设计、节奏、承诺兑现、爽点分布、人设卖点，并结合当前项目定位给可执行结论。

## 5. 结论落地

- 分析结论整理成短文档，经用户确认后写入 `lorebook/note/genre-research/`（独立调研节点）或 `lorebook/note/project-positioning/`（直接影响定位时），供 `novel-setup` / `novel-writing` 消费。
- 未经确认前，调研产物只在对话里呈现，不落 lorebook。

## 边界

- 不伪造榜单数据、销量、读者评论；工具拿不到的数据如实说拿不到。
- 题材惯例讨论可以基于模型知识，但要明确告知这是经验性讨论，不是实时市场数据。
- 调研产物是参考资料，不直接改写用户的定位与设定；结论经用户确认后才写入 lorebook。
