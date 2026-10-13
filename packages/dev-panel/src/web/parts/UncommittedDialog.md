---
标签: ["env:portal", "env:global"]
---

# UncommittedDialog

目标文件在主工作区有别人没提交的改动时的确认（t10，待决问题 8）：已暂存的改动与工作区里还没暂存的改动分两段显示（`git add` 会用工作区的内容替换暂存的那一份），未跟踪的文件写明整份会随提交入库。选“连同这些改动一起提交”才放行；这些改动会以面板的名义提交进 master，提交作者是主工作区的 Git 身份。

## 数据

```ts
interface UncommittedDialogProps {
    /** 是否打开；必填、受控 */
    open: boolean;
    /** 目标文件的仓库根相对路径；必填 */
    path: string;
    /** 服务端 409 `uncommitted_changes` 的 details 里的改动；必填，可为 null */
    changes: UncommittedChanges | null;
    /** 确认的请求进行中；必填 */
    pending: boolean;
}
interface UncommittedDialogEmits {
    (event: "confirm"): void;
    /** 取消、点遮罩或按 Escape */
    (event: "cancel"): void;
}
```

没有插槽与 expose。内容经 nb-ui 的 `Dialog` 渲染到 `body`（`env:portal`），Esc 与点遮罩关闭（`env:global`，都发 `cancel`）。
