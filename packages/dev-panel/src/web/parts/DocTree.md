---
标签: ["state:local"]
---

# DocTree

文档页左边按类型分组的文档树：入口（AGENTS 等）、Spec（按目录分小节）、ADR、Proposal、模块、规范、测试、意图、包文档、Skill、文档站。不是主工作区时，每个文件标出与 master 的差异：分支新增、改动、删去（划掉），以及 master 上新增而这里没有的（灰色）。删去的与 master 才有的文件这里没有正文，点不了。

## 数据

```ts
type DocEntry = {path: string; group: string; section: string};
type DocChange = {path: string; change: "added" | "modified" | "deleted" | "master_only"};
interface DocTreeProps {
    /** 这个 checkout 的文档；必填 */
    docs: DocEntry[];
    /** 与 master 的差异（主工作区为空）；必填 */
    changes: DocChange[];
    /** 当前打开的文档路径；可选 */
    selected?: string | null;
    /** 只看有差异的；可选，默认 false */
    changedOnly?: boolean;
}
interface DocTreeEmits {
    (event: "open", path: string): void;
}
```

没有插槽与 expose。`state:local` 是各组的展开状态（缺省只展开当前文档所在的组，有差异时展开有差异的组）。
