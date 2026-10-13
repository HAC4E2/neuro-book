---
标签: []
---

# SearchResults

搜索结果：最上面是缓存里 Work、Task、产物标题与会话的匹配，下面按 checkout 分组列文件名与内容的匹配（内容带行号与那一行），结果流式到达时逐条出现；某个 checkout 截断了（超过 200 条或 5 秒）时标出来。

## 数据

```ts
interface SearchResultsProps {
    /** 记录的匹配；必填 */
    records: SearchRecordMatch[];
    /** 文件的匹配；必填 */
    hits: SearchHit[];
    /** 做完了的 checkout；必填 */
    done: SearchCheckoutDone[];
    /** 整组搜索结束了；必填 */
    finished: boolean;
}
interface SearchResultsEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。记录的匹配与 Markdown 文件的匹配是真实链接（`<a href>`，去对应页与文档页），能在新标签页打开；其它文件面板不提供正文，只列出来。
