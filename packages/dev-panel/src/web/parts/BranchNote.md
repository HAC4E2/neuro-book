---
标签: []
---

# BranchNote

“来自分支”的警示条：过渡期里记录还在某个实现分支上维护的 Work，面板读的是它的执行 worktree，nbdev 不写它。卡片与 Work 页上都放这一条，提醒开发者这里看到的不是 master 上的记录。

## 数据

```ts
interface BranchNoteProps {
    /** 执行 worktree 的分支；可选，未知时为 null */
    branch: string | null;
    /** 执行 worktree 的 checkout key；可选 */
    checkoutKey?: string | null;
}
```

没有事件、插槽与 expose。
