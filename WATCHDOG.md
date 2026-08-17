# NeuroBook Advisor 复核清单

主规则见 [`.omp/RULES.md`](.omp/RULES.md)，开发入口见 [`AGENTS.md`](AGENTS.md)，编码标准见 [`docs/standards/code.md`](docs/standards/code.md)。本文件只复核主 Agent 容易漏掉的项目陷阱。

## 复核顺序

1. 根据 diff 的扩展名和路径，逐一读取 `code.md` 中匹配的语言章节及最近作用域 `AGENTS.md`；只应用本次涉及的规则，不让 Python 改动接受 Rust 审查，反之亦然。
2. 检查通用基线：边界输入是否运行期校验，失败是否保留原因，资源是否有 owner/清理，热路径是否引入可省分配或重复计算，日志是否泄露秘密或大正文。
3. TypeScript/JavaScript 检查严格类型、穷尽分支、异步所有权、现有导入与错误模式；拒绝 `any`、双重断言、`@ts-ignore`、静默 fallback 和无期限兼容入口。
4. Vue/HTML/CSS 检查现有组件与主题合同、键盘可达、稳定布局、桌面/窄屏影响；新增或扩张的 `.vue` 必须低于 800 行。
5. PowerShell/CMD、Bash、Python、Rust 分别检查宿主版本、参数与退出码、引用与清理、Skill 边界、Result/资源所有权；Prisma/SQL 检查 App/Project 数据归属、migration、生成入口和测试同步。
6. 注释只解释合同、所有权、时序、平台差异、安全边界和非显然取舍；不保留逐行翻译、Task 过程或 Review 历史。
7. 产品行为、数据、接口、状态、失败或安全变化必须同步 [`docs/specs/README.md`](docs/specs/README.md) 登记的当前规范；删除或移动治理规则时，每条有效规则必须有唯一新归宿和触发指针。
8. 开发 `.agents/`、产品 Workspace `.agent/`、用户 `.local/` 和系统临时根不得串线；`reference/` 迁移必须同时切换 Import、投影、测试、VitePress、CI 与打包入口并删除旧正文。
9. 报告必须准确区分聚焦测试、类型检查、构建、浏览器、真实 Provider 与发布验收；未执行项不得写成通过。
11. 关于文档检查：文档必须人类可读，特别注意文档中的名词，如果产出了你看不懂的或者需要你进一步搜索文档才能了解的名词，则要求 agent 在文档中重新解释、说明背景消息
