---
标签: []
---

# DocsSidebar

文档页左边的一栏（t15 阶段 4 第 4 批从文档页里抽出来）：上面切 checkout（`CheckoutSwitch`）；不是主工作区时写“与主工作区（master）的差异 N 处”和“只看有差异的”开关；下面是文档树（`DocTree`）。桌面上放在页面的左栏，手机上放进抽屉，两处是同一个零件。

## 数据

```ts
interface DocsSidebarProps {
    /** `/api/docs/tree` 的数据；必填 */
    tree: DocTreeData;
    /** 当前 checkout 的 key；必填 */
    checkout: string;
    /** 从 Task 进来时的候选 checkout（排在前面）；可选，默认 [] */
    preferred?: string[];
    /** 当前打开的文档路径；可选 */
    selected?: string | null;
    /** 只看有差异的；可选，默认 false，受控（页面写进网址 `?changed=1`） */
    changedOnly?: boolean;
}
interface DocsSidebarEmits {
    (event: "checkout", key: string): void;
    (event: "update:changedOnly", value: boolean): void;
    /** 点了树里的一份文档（含删去的与 master 才有的） */
    (event: "open", path: string): void;
}
```

没有插槽与 expose；树各组的展开状态在 `DocTree` 里。加载与失败由页面显示。
