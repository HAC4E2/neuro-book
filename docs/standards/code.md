# 编码与审查标准

本文件按改动类型触发。只读取并应用“通用基线”以及本次改动所涉及语言或文件类型的章节；修改 `.vue` 时同时应用 TypeScript、Vue/HTML 与 CSS 章节。目录特有合同由最近的 `AGENTS.md` 补充。

## 通用基线

- 先读相邻实现、测试、配置和公开合同，沿用已有模块、命名、错误、日志和测试工具。抽象必须减少真实重复、复杂度或所有权歧义；单调用 wrapper 不进入代码库。
- 外部输入在系统边界解析、校验和归一化。失败尽早、明确且可诊断；缺配置、权限、引用或前置产物时返回现有错误合同，不增加静默 skip 或未经批准的 fallback。
- 保存、网络、进程、迁移和跨语言边界必须定义成功、失败、清理与重试所有权。迁移完整切换消费者并删除旧入口，不保留无期限 alias、`legacy` 分支或双写。
- 热路径避免可省的分配、复制、序列化、目录扫描和重复计算；先测量再引入缓存，缓存必须有失效与所有权合同。
- 日志使用结构化字段和自然语言消息；不记录 API Key、Token、设备码、小说正文、完整提示词、Session 内容或未经脱敏的请求体。
- 测试覆盖可观察合同、边界、状态转移和真实失败。测试不匹配源码字符串、私有调用顺序或偶然默认值；临时数据遵循 [`../testing/README.md`](../testing/README.md)。

## TypeScript 与 JavaScript

适用：`*.ts`、`*.tsx`、`*.js`、`*.mjs`、`*.cjs`。

- 遵循仓库 ESM 与 `strict` 配置；4 空格缩进、双引号、分号。Node 内置模块使用 `node:` 前缀。跨根目录导入使用 `nbook/*` 或所属包的公开入口，不创建穿越项目边界的相对路径。
- 领域概念用命名类型表达；联合类型必须穷尽处理。`unknown` 只用于尚未验证的边界值并立即收窄；不使用 `any`、双重断言、`@ts-ignore` 或非空断言掩盖合同缺口。
- JSON、YAML、环境变量、HTTP、IPC、文件和 Provider 返回值使用现有 schema、解析器或类型守卫校验；类型声明不能代替运行期验证。
- 异步工作必须被 `await`、返回或由明确的生命周期 owner 持有；并发任务定义取消、超时和清理。保留底层错误的 `cause`、状态码或现有错误类型，不只返回模糊字符串。
- 后端领域模块沿用现有 class/facade/repository 结构；前端与简单纯函数沿用函数式模式。不要为个人偏好在同一领域建立第二套模式。
- 数据集合优先单次遍历和稳定 key；避免无必要的 spread、深拷贝、JSON 往返和循环内重复构建 `Map`、正则或 formatter。
- 结构化日志示例：`logger.debug({kind: message.kind}, "已处理 Agent 消息")`。字段名稳定，秘密和大正文只记录尺寸、摘要或脱敏标识。

## Vue 与 HTML

适用：`*.vue` 及前端模板；同时应用 TypeScript 章节。

- 使用 Composition API 和仓库现有函数式风格；props、emits、slot 与 template ref 保持类型完整。派生状态用 `computed`，`watch` 只承载副作用并负责停止订阅、计时器和请求。
- 通用界面能力复用 `app/components/common`、`resolveApiErrorMessage()`、`useNotification()` 和 `useResizablePanel()`；具体主题、状态色、Dialog 与反馈合同见 [`../../app/AGENTS.md`](../../app/AGENTS.md)。
- 交互控件使用语义 HTML、键盘可达名称、正确的 disabled/focus 状态；图标按钮提供可访问名称或 Tooltip。用户文字面向第一次使用 NeuroBook 的普通作者，不泄露内部标识。
- 列表 key 必须稳定且来自实体身份；避免把数组下标当持久身份。昂贵派生不在 template 重复调用；布局尺寸使用稳定约束，避免加载、hover 或长文本造成跳动和遮挡。
- 前端变更说明桌面和窄屏影响。聚焦测试不等于浏览器验收；实际浏览器验收必须运行真实表面并保留可观察证据。
- `.vue` 单文件组件达到或超过 800 行是硬审查线。新增职责前按稳定边界拆出组件、composable、store 或领域模块；零散 helper 不能用来掩盖组件继续膨胀。

## CSS 与主题

适用：`*.css`、`*.scss` 和 Vue style block。

- 普通界面颜色只消费 `app/utils/theme/README.md` 登记的语义变量；不新增 Tailwind 调色板类、局部硬编码主题色或 `dark:` 变体。新增变量时同步主题文档与全部内置主题。
- 样式由组件或语义 class 拥有，避免高特异性 selector、无归属全局覆盖和 `!important` 竞争。动画尊重 reduced motion；文本、焦点环和状态色保持可辨识。
- 固定格式控件、面板、棋盘或网格使用 `min/max`、grid track、`aspect-ratio` 等稳定约束；不按 viewport 宽度缩放字体，不使用负 letter spacing 修补溢出。

## JSON 与 YAML

适用：`*.json`、`*.jsonc`、`*.yaml`、`*.yml` 和结构化配置生成器。

- 使用解析器修改结构化数据，不用正则或字符串拼接。保持现有缩进、键顺序和尾随换行；JSON 不加入注释或非标准值。
- 新字段定义默认值、缺失语义、版本兼容和秘密边界。消费环境变量时区分“未设置”与空字符串；输出应确定性排序，避免无意义 diff。
- Workflow、Issue Form 和发布元数据改动运行仓库已有校验，不以 YAML 可解析代替行为合同通过。

## PowerShell 与 CMD

适用：`*.ps1`、`*.psm1`、`*.cmd`、`*.bat`。

- 发行 PowerShell 兼容 Windows PowerShell 5.1：使用 `[CmdletBinding()]`、显式 `param`、`$ErrorActionPreference = "Stop"`、`$PSScriptRoot` 与 `-LiteralPath`；不使用仅 PowerShell 7 支持的语法。
- 调外部程序使用调用运算符与参数数组，立即检查并传递 `$LASTEXITCODE`；路径和用户输入不经 `Invoke-Expression`。异常包含操作、目标和原始原因，清理放入 `finally`。
- 含非 ASCII 的发行 `.ps1` 使用 UTF-8 BOM；明确要求无 BOM 的外置 Host 脚本保持 ASCII。文件读写显式选择与目标合同一致的编码，不依赖宿主默认编码。
- 凭据和敏感正文不放入 argv、环境变量、进程标题或日志。`.cmd` 只做带引号的宿主启动与退出码转发，复杂逻辑进入可测试的 PowerShell 或 TypeScript 入口。

## Bash

适用：`*.sh` 和 POSIX 容器入口。

- Bash 脚本使用明确 shebang、`set -euo pipefail`、带引号的参数展开和数组；临时目录用系统工具创建并用 `trap` 清理。确需 POSIX `sh` 时不用 Bash 专属语法。
- 检查依赖命令和输入文件，错误写入 stderr 并保留被调用程序退出码。不用 `eval` 拼命令，不把秘密放进 argv 或 trace。
- 产品与文档明确区分 Git Bash、WSL、Linux 和 PowerShell；不把仅在一种 shell 有效的命令写成通用 Windows 流程。

## Python

适用：`*.py`。当前 Python 仅用于所属 Skill 的工具脚本。

- 脚本留在 Skill 内并沿用其依赖、入口和验证方式；不引入仓库级 Python runtime、虚拟环境或平行依赖管理。
- 使用 4 空格、`pathlib`、标准库结构化解析和 `if __name__ == "__main__":`；公共函数与跨文件数据加类型标注。文件操作显式使用 UTF-8，保留目标格式的换行合同。
- CLI 使用 `argparse` 或所属 Skill 的既有入口，失败写 stderr 并返回非零退出码。子进程传参数数组且不使用 `shell=True`；临时文件使用系统临时根并负责清理。

## Rust

适用：`desktop/tauri/**/*.rs` 与 `Cargo.toml`。

- 以 `cargo fmt --manifest-path desktop/tauri/Cargo.toml --check` 和 `cargo check --manifest-path desktop/tauri/Cargo.toml` 为基本门禁；遵循现有 Tauri、serde 与平台 `cfg` 组织。
- 可恢复的文件、网络、IPC 和用户输入错误通过 `Result` 返回并保留上下文；运行路径不使用 `unwrap()`/`expect()` 代替错误合同。`unsafe` 只包围无法避免的平台调用，并记录不变量和资源释放责任。
- 进程、线程、channel、handle 与临时资源必须有唯一 owner、超时和 Drop/关闭路径。避免无必要的 `clone`、字符串分配和大值跨线程复制。
- 跨语言合同以 `desktop/shared` 与 `shared/` DTO、schema 和合同测试为准，不在 Rust 侧复制独立产品模型。

## Prisma 与 SQL

适用：`prisma/**/*.prisma`、`prisma/migrations/**/*.sql`、数据库配置和生成入口。

- 先确认修改属于 App SQLite 还是 Project SQLite；schema、migration、生成入口、数据 owner、备份/升级语义和相应测试必须同步。生成 client 只由 `bun run generate` 产生，不手改 `server/generated/`。
- migration 使用既有目录和命名合同，显式列出列名、约束、索引和数据选择条件；表重建必须保留应保留数据并明确丢弃条件。不要靠 `legacy` 列、双写或静默数据修补隐藏未完成迁移。
- SQL 标识符和字符串按目标数据库正确引用；危险操作前定义前置条件、事务/失败语义和可验证结果。migration 一旦进入共享历史，不改写其既有语义，新增后续 migration 修正。
- 数据库迁移执行需要用户授权；静态合同检查、聚焦测试和 client 生成不能写成真实数据升级已验证。

## 注释与文件规模

- 注释解释调用合同、所有权、时序、平台差异、安全边界、资源生命周期和非显然取舍；公开接口说明用途与失败语义。显然控制流、逐行翻译、Task 过程和 Review 历史不写进代码。
- 新职责优先放进拥有该职责的现有模块。除 `.vue` 的 800 行硬审查线和治理入口的合同上限外，不以机械行数代替职责判断；advisor 应审查文件是否因多重 owner、状态机或平台分支而需要拆分。
