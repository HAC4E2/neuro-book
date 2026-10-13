---
标签: []
---

# InboxList

首页最上面的收件箱：只放要开发者动手的事——还没答的必答题与撞号（Proposal 第三节：会话在等的事只认登记成提问的，不从终端推断）。每道题写明在哪个 Work、Task、产物里，谁问的，提问者的租约已经失效时标出来（问的会话已经不在，答了要等别的会话来采纳）。

## 数据

```ts
type InboxQuestion = {kind: "question"; workId: string; taskId: string; artifactId: string; questionId: string; label: string; type: string; version: number; since: number; askedBy: string | null; askerActive: boolean | null};
type InboxConflict = {kind: "number_conflict"; label: string; live: boolean};
interface InboxListProps {
    /** 收件箱条目；必填，空数组时显示空态 */
    items: Array<InboxQuestion | InboxConflict>;
}
interface InboxListEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。每道题是去它所在产物页的真实链接（`<a href>`），能在新标签页打开。撞号没有对应页面，只列出来，点不了。
