# 文档信息架构整理提案

状态：draft

## 问题

当前 `docs/` 同时包含稳定规范、Module 索引、测试合同、人工评测、调研、历史实践和 VitePress 初始化示例；原 `docs/drafts/` 已迁出版本库。`reference/` 又保存大量当前实现合同，并被产品 Agent/Profile 直接消费。维护者仍需要一个索引判断哪个文件是当前规范，Agent 也可能把 Task 或历史记录误当作现行行为。

## 目标

- 每项功能有且只有一个当前规范真相源。
- 当前规范足以描述可观察行为、数据和接口，使实现可被大致重建。
- Proposal、Task、ADR、migration、research 和 archive 各自只承担一种职责。
- 保持产品 `reference/` 消费链可用，迁移过程中不复制两份可修改规范。

## 目标结构

```text
docs/
├── README.md               文档治理入口
├── specs/                  当前有效功能规范的统一入口；迁移期先做注册表
│   └── README.md
├── proposals/              尚未生效的跨模块提案
│   ├── README.md
│   └── <proposal>.md
├── adr/                    已接受且需要长期解释的架构决策
├── testing/                测试、验收、临时根和证据规则
├── manual-eval/            用户视角人工评测体系
├── migrations/             用户或运维必须执行的数据升级与回滚
├── research/               外部资料与未验证调研
└── archived/               过期材料；不作为当前行为依据

.agents/tasks/              一次实现任务的合同、交接和正式证据
reference/                  过渡期产品 Agent/Profile 消费的当前规范正文
vitepress/                  面向用户的发布站点，不承担内部规范真相源
.local/drafts/              用户管理的草案，不是仓库规范或开发输入
```

## 内容分类规则

| 内容 | 唯一归宿 | 是否当前行为依据 |
|---|---|---|
| 功能行为、状态、数据、接口、失败语义、验收 | `docs/specs/` 注册的规范 | 是 |
| 未批准的长期方案与备选取舍 | `docs/proposals/` | 否 |
| 已接受架构决策及理由 | `docs/adr/` | 是，但只解释决策；完整行为仍在 spec |
| 一次实现的范围、进度、角色交接、日志和证据 | `.agents/tasks/` | 否 |
| 数据升级、备份、回滚操作 | `docs/migrations/` | 是，限迁移流程 |
| 第三方调查、实验和比较 | `docs/research/` | 否 |
| 用户教程和发布说明 | `vitepress/` | 否，内容应投影自已批准行为 |
| 已过期或仅供考古的材料 | `docs/archived/` | 否 |

## 当前目录审计与建议

### 保留并强化

- `docs/adr/`、`docs/testing/`、`docs/manual-eval/`、`docs/migrations/`、`docs/research/`、`docs/archived/`：职责清楚，补齐索引与状态即可。
- `docs/modules/monorepo-boundaries.md`：现阶段登记为 Monorepo 规范；未来迁到 `docs/specs/architecture/` 后删除旧入口。
- `docs/modules/character/requirements.md`：现阶段登记为 Character 规范；补齐状态、失败语义和验收后再迁。
- `reference/<module>/`：保持当前产品消费路径，逐模块迁移，不能批量改名。

### 已迁出版本库的草案

原 `docs/drafts/` 的 6 个文件已整体移动到用户管理的 `.local/drafts/`，`docs/drafts/` 已删除。迁移不改变文件内容；历史 Task 中的旧路径文本作为 provenance 保留，不再保证可解析。

这些本地草案不属于当前规范、Proposal、Issue、Task、CI 或发布输入。需要恢复其中任一方向时，先由用户明确指定草案，再把有效内容提炼到 `docs/proposals/`、`docs/specs/` 或 GitHub Issue；Agent 不得默认扫描 `.local/drafts/`。

### 从稳定层移出

- `docs/api-examples.md`、`docs/markdown-examples.md`：VitePress 模板示例，不是 NeuroBook 规范；若站点不消费则删除，否则移到 `vitepress/examples/`。
- `docs/writing-mode-world-engine-practice.md`：一次项目实践记录，事实可能有历史价值但不是当前规范；迁入 `.agents/tasks/archived/` 对应任务或 `docs/archived/practices/`，当前规则继续由 `reference/world-engine/` 承担。

## 迁移批次

1. **建立索引**：提交 `docs/specs/README.md`、`docs/proposals/README.md` 和本提案；所有新功能先登记规范归属。
2. **清理明显错位项**：草案目录迁入 `.local/drafts/` 已完成；两个 VitePress 模板示例和实践记录仍待处理，移动时同步链接。
3. **转正用户指定草案**：只有用户明确恢复某份 `.local/drafts/` 草案时，才将方案提炼为 Proposal，并把批准规则写入对应 spec；不要把本地原文直接迁回仓库。
4. **按模块迁移 Reference**：优先 Agent、World Engine、Content、Plot，再迁 Editor、Theme、Media。每批先列产品 Import、投影、测试、VitePress 和打包消费者；单次切换后删除旧路径。
5. **设置门禁**：新增文档检查，要求功能变更关联一个 spec，Proposal 不得被实现或测试当作规范导入，Task 完成时检查 spec 是否同步。

## 验收条件

- `docs/specs/README.md` 能为每个活跃功能找到唯一当前规范。
- 根 `docs/` 不再有 `drafts/`；用户草案只在 `.local/drafts/`，且不作为 CI、发布或 Agent 默认输入。
- 每个 accepted Proposal 都链接已更新的当前规范和实现 Task。
- 每个 active Task 都链接相关规范；没有规范的功能 Task 不能进入实现状态。
- `reference/` 迁移批次通过产品 Import、资产投影、测试、构建和站内链接检查后才删除旧路径。
- `bun run docs:build`、治理检查和链接检查通过。

## 决策请求

建议批准本结构，并把 `docs/specs/` 定为当前规范统一入口；`reference/` 作为迁移期产品消费层逐模块收敛。草案已退出版本库，后续只有被用户明确恢复并提炼的内容才能进入 Proposal、规范或 Issue。