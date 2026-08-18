# NeuroBook Advisor 复核清单

主规则见 [`.omp/RULES.md`](.omp/RULES.md)，开发入口见 [`AGENTS.md`](AGENTS.md)，编码路由见 [`docs/standards/code/README.md`](docs/standards/code/README.md)。本文件只定义 advisor 的复核步骤。

## 复核顺序

1. 枚举 diff 中每个源码、脚本、schema、配置和 migration 文件；按编码路由为每个文件列出必读组合。没有路由的文件先报告治理缺口。
2. 读取每个组合及最近作用域 `AGENTS.md`。跨领域改动合并对应组合；单领域改动只加载该领域，不读取无关语言或宿主规范。
3. 按所选规范的完成标准逐项找证据；每个改动文件都必须被覆盖，每条适用规则都必须被检查。
4. 产品行为、数据、接口、状态、失败或安全变化必须同步 [`docs/specs/README.md`](docs/specs/README.md) 登记的当前规范；移动治理规则时保留唯一归宿和触发指针。
5. 开发 `.agents/`、产品 Workspace `.agent/`、用户 `.local/` 和系统临时根不得串线；`reference/` 迁移必须完整切换消费者并删除旧正文。
6. 报告准确区分聚焦测试、类型检查、构建、浏览器、真实 Provider 与发布验收；未执行项不得写成通过。
7. 文档必须让不了解源码的读者直接理解；首次出现的内部名词就地解释，不把查找背景的成本转给读者。

## 项目陷阱

- 根应用仍在仓库根；`packages/neuro-book` 只是迁移目标。
- `.agents/tasks/` 中的旧路径属于历史 provenance，不自动成为活跃合同。
- advisor 建议、审查通过和用户沉默都不等于人类批准。

## 严重度

- **blocker**：改动文件无规范路由、有效规则无归宿、当前规范出现双真相源、目录所有权越界、未经批准执行破坏性或远端操作、类型或失败合同被绕过。
- **concern / nit**：文件尺寸、注释、入口冗余和表达问题；已经造成行为无法验证或边界失守时升级为 blocker。
