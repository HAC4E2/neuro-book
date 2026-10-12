# 本地资产目录

`.local/` 放不进仓库的本地东西：除本文件外全部被 Git 忽略，不属于产品源码、发布输入，也不作为 CI、发布与测试的默认输入。什么进 Git、什么留在这里，判据见 [Work 规则的“本地与入库”](../.agents/works/README.md#本地与入库)。

目录分两块：Agent 管的 `agent/`，与用户管的其余目录。

## Agent 区：`agent/`

Agent 可以读写。按 Work 与 Task 组织，仓库 Work 与本地 Work 用同一套布局（两类 Work 见 [Work 规则](../.agents/works/README.md#仓库-work-与本地-work)）：

```text
.local/agent/
└── works/<workId>/
    ├── README.md              # 只有本地 Work 才有：Work 本身就在这里
    ├── review/                # Work 级的讲解页与回顾页（可选）
    └── tasks/<taskId>/
        ├── README.md          # 只有本地 Work 才有
        ├── review/            # 讲解页与评审板：index.html 是入口，各轮的图放 r1/、r2/…
        ├── answers/           # 开发者提交的答案，只追加不改
        ├── reports/           # 子代理、omp 的报告原文与会话目录
        ├── shots/             # 截图（含验收截图）
        └── logs/              # 测试与检查的原始输出、开发服务日志
```

- 这些东西放这里，不放会话临时目录：`/tmp` 下的会话目录在重启或清理后就没了。会话临时目录只放用完即弃的脚本。
- 不放密钥与个人数据。
- 用不到的子目录不建。

## 用户区：其余目录

用户管理的本地素材。Agent 只在用户明确要求时读取、写入、移动或删除；来源、更新、备份、授权与清理由用户负责，仓库治理不替用户管理。需要进入仓库的脱敏结果放进对应 Task。

- `github/`：外部第三方调研仓库。默认只作人工调研参考，不自动拉取、更新或改写。
- `datasets/`：本地数据集和评测语料。
- `drafts/`：从仓库 `docs/drafts/` 移出的用户草案、原始提示词和个人 TODO。它们不是当前规范、Proposal 或 Task；需要恢复开发时先提炼为仓库内的规范、Proposal 或 Issue。
- 其他目录：用户自行管理的本地素材，例如书籍资料和角色草稿。
