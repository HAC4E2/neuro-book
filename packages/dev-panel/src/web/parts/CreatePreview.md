---
标签: ["state:local"]
---

# CreatePreview

新建的预览（t10）：预计领到的号与完整 id、要写的文件（仓库根相对路径，展开看内容）、提交信息、字段的问题。号旁边写“以提交时为准”：预览不取锁，提交之前有人领了号就顺延。

## 数据

```ts
interface CreatePreviewProps {
    /** `POST /api/preview/work|task` 的结果；还没填时为 null；必填 */
    preview: CreatePreviewData | null;
    /** 预览请求进行中；必填 */
    loading: boolean;
}
```

没有事件、插槽与 expose。各文件的展开状态是本地状态。
