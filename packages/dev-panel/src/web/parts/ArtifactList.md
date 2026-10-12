---
标签: []
---

# ArtifactList

产物页的列表（t03 第二轮产物页的列表）：按类分组——设计稿、讲解与报告、审查报告、提问集、还没发布的、文档类产物（Task 目录里的 Markdown）与证据（各 Task 的数目）。每条写明属于哪个 Work 与 Task、版本、待答数与采纳状态。过滤由页面做，这里只排版。

## 数据

```ts
interface ArtifactListProps {
    /** 有发布记录的与没发布的产物；必填 */
    artifacts: ArtifactListItem[];
    /** 文档类产物；必填 */
    documents: DocumentListItem[];
    /** 各 Task 的证据数；必填 */
    evidences: EvidenceListItem[];
}
interface ArtifactListEmits {
    (event: "open-artifact", item: ArtifactListItem): void;
    (event: "open-document", item: DocumentListItem): void;
    (event: "open-task", workId: string, taskId: string): void;
}
```

没有插槽与 expose。全部为空时显示空态。
