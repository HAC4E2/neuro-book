---
标签: ["state:local"]
---

# PanelNav

面板的导航（t15 阶段 2b）：桌面的左栏与手机的抽屉用的是同一个零件，所以两处的条目、Work › Task 两层与高亮完全一致。上段是固定的入口（首页与收件箱、新建、资料、现场与计数），下段是单独滚动的 Work 树，900 高时首屏就看得到“现场”。条目来自面板自己的描述表 `host/nav.ts`，Work 树按 D4 只列活跃的 Work，其余收进“更多”。

## 布局

自上而下：品牌行（去首页的链接，右边是宿主给的 `actions` 插槽，例如桌面左栏的“收起左栏”）；上段的几组入口（无标题的一组是首页与新建，然后是“资料”“现场”），条目右边是计数（收件箱是醒目的徽章，会话、在跑是灰字数）；“工作”标题与 Work 树。根铺满父级高度、竖向排列：上段不滚，Work 树占剩下的高度、自己竖向滚动（`scrollbar-gutter: stable`）。高度不够时 Work 树先缩，上段不动。

Work 树的每一行是展开按钮加 Work 链接（编号灰字、标题），展开后在下面缩进列出它的 Task（编号灰字、标题）。标题放不下时截断，指针停在上面或键盘聚焦时用 nb-ui 的 `Tooltip` 显示全文（只给真的被截断的那几行）。活跃的 Work 列完之后是“更多 N 个”按钮，点开在下面列出其余的 Work（完成、搁置、30 天没有更新的未标 Work、状态写坏的）。

宽度跟父级走（桌面左栏可调宽，抽屉 380px、最多视口的 90%）；390 宽时在抽屉里，结构不变。

## 交互

- 每个条目都是真实链接（`<a href>`），能在新标签页打开、能复制地址。普通左键点击时零件 `preventDefault` 并发 `navigate`，由宿主 `router.push`；中键与带修饰键的点击交给浏览器。
- 高亮：当前页的条目带 `aria-current="page"` 与选中底色；在 Task 页时，所属 Work 那一行用较淡的底色。`current` 变了（以及挂载时），Work 树把当前那一行滚进可视区（只在树里滚，不动整页）。
- 展开：没记过的 Work 缺省收起，当前所在的 Work 缺省展开；点展开按钮发 `toggle`，由宿主记住（`expanded` 是受控值）。当前 Work 在“更多”里时，“更多”自动展开。
- 键盘：上段每个入口各是一个 Tab 停靠点；Work 树整体只有一个停靠点（停在当前那一行，没有就停在第一行），树里用方向键走：上下移到上一行、下一行，Home、End 到第一行、最后一行；在 Work 行上按右键展开（已展开时进到第一个 Task），按左键收起；在 Task 行上按左键回到所属的 Work。Enter 打开链接。展开按钮不进 Tab 顺序（鼠标点它，键盘用左右键），“更多”是一个按钮、单独一个停靠点。

## 数据

```ts
import type {NavCount} from "../host/nav.js";
import type {OverviewWork} from "../host/types.js";

interface PanelNavProps {
    /** `/api/overview` 的 Work（含各自的 Task）；必填，null 表示还没读到（树的位置写“正在读取”） */
    works: OverviewWork[] | null;
    /** 当前页：路径（不含查询参数）与路由参数里的 Work、Task；必填 */
    current: {path: string; workId: string | null; taskId: string | null};
    /** 用户展开或收起过的 Work（受控）；必填，没记过的按“当前 Work 展开、其余收起” */
    expanded: Record<string, boolean>;
    /** 条目右边的计数；可选，默认 {}，缺项不显示 */
    counts?: Partial<Record<NavCount, number>>;
    /** 主工作区能不能写（`/api/meta` 的 `mainWritable`）；必填，null 表示还不知道（不显示新建），不能写时把新建换成一句原因 */
    writable: {ok: boolean; code: string | null} | null;
    /** 判断“30 天内更新过”用的当前时刻；可选，默认渲染时的时刻 */
    now?: Date;
}
interface PanelNavEmits {
    /** 普通左键点了一个条目；参数是面板内的地址 */
    (event: "navigate", href: string): void;
    /** 点了展开按钮，或在树里按了左右键；`open` 是要变成的状态 */
    (event: "toggle", workId: string, open: boolean): void;
}
interface PanelNavSlots {
    /** 品牌行右边的操作；可选，缺省为空 */
    actions?: () => unknown;
}
```

插槽 `actions` 没有作用域参数。没有 expose；attrs 落到根节点。

## 状态

- 加载中：`works` 为 null 时，树的位置是一行“正在读取”；上段照常可用。
- 空：没有活跃的 Work 时写“没有进行中或 30 天内更新过的 Work”，“更多”照常给。
- 不能写：新建的入口换成“主工作区现在不能写（原因码），写入口已隐藏”。

`state:local`：哪些行被截断（量出来的，宽度变了重量）、树里键盘停在哪一行、“更多”是否展开；组件销毁即丢。

## 不支持

- 不读路由、不跳转：`current` 由宿主给，跳转由宿主做。
- 不记偏好：展开状态由宿主经 `host/prefs.ts` 记住。
- 不做搜索、拖动排序与收藏。

## 注意事项

- 根要放进有确定高度的父级（左栏面板、抽屉正文），Work 树才会自己滚；父级不限高时整个导航跟着父级一起滚。
- “更多”里的 Work 与树里的 Work 用同一套行；键盘走到“更多”展开出来的那些行时，方向键照样能走。
