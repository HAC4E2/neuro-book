# 正文编辑器表面规格

> 状态：Accepted（2026-08-16，第二轮前端组件设计）。  
> 稳定组件名：`DocumentEditorSurface`。中文展示名暂不固定。  
> 范围：正文阅读、选区、批注、规则命中、AIGC 热力图和 DraftSession 编辑。  
> 非范围：盲评分表、机器揭示、工作面板、历史版本选择和跨版本比较流程。

## 1. 组件定位

`DocumentEditorSurface` 是评判工作区唯一的正文交互表面。同一组件承担两类文档：

1. `revision`：不可变正文。用于每个 revision 的首次阅读与盲评，也用于揭示后的只读查看。
2. `draft`：DraftSession 的派生正文。用于查看与修改阶段的人工编辑、规则修复和 Agent proposal 审阅。

组件不接收 `blind-review`、`inspect-edit`、owner 或 Arena 等流程状态。外层阶段控制器决定传入哪类文档、哪些 overlay 和哪些 capability。这样 owner 盲评和未来 Arena 众评可以复用正文、选区与批注交互，同时继续使用不同的权限、exposure 和提交 API。

组件必须保持受控：正文、overlay、authoritative DraftSession identity 和持久化批注都由外部 owner 提供。组件只拥有光标、选区、输入法 composition、菜单开关和短时强调等局部 UI 状态。

## 2. 文档身份

```ts
type RevisionSurfaceDocument = {
    kind: "revision";
    revisionId: string;
    ordinal: number;
    body: string;
    bodyFingerprint: Fingerprint;
};

type DraftSurfaceDocument = {
    kind: "draft";
    draftSessionId: string;
    baseRevisionId: string;
    authoritativeGeneration: number;
    authoritativeBodyFingerprint: Fingerprint;
    workingVersion: number;
    body: string;
    bodyFingerprint: Fingerprint;
    pendingEditCount: number;
    saveState: "saved" | "saving" | "unsaved" | "failed" | "offline";
};

type DocumentSurfaceDocument = RevisionSurfaceDocument | DraftSurfaceDocument;
```

`revision` 永远只读。`draft.body` 是即时受控的 working body；`authoritativeGeneration` 和 `authoritativeBodyFingerprint` 只随服务器成功响应推进，`workingVersion` 在每次本地 splice 后单调递增。组件不得把 working version 冒充服务器 generation。

ordinal 只用于展示。组件事件和 overlay 归属使用 revision id，或 DraftSession id、authoritative generation、working version 与 working body fingerprint，不使用“当前版本”或数组位置猜测目标。

## 3. 组件模型

```ts
type DocumentEditorSurfaceModel = {
    document: DocumentSurfaceDocument;
    overlays: DocumentSurfaceOverlays;
    focusRequest: DocumentFocusRequest | null;
    capabilities: DocumentSurfaceCapabilities;
    display: DocumentSurfaceDisplay;
};

type DocumentFocusRequest =
    | {requestId: string; kind: "offset"; offset: number}
    | {requestId: string; kind: "rule-hit"; hitId: string}
    | {requestId: string; kind: "annotation"; annotationId: string}
    | {requestId: string; kind: "draft-change"; editId: string};

type DocumentSurfaceCapabilities = {
    canEdit: boolean;
    canAnnotate: boolean;
    canInvokeAgent: boolean;
    canApplySuggestion: boolean;
    canUndo: boolean;
    canRedo: boolean;
};

type DocumentSurfaceDisplay = {
    ruleHits: boolean;
    heatmap: boolean;
    annotations: boolean;
    draftChanges: boolean;
};
```

约束：

- `document.kind="revision"` 时 `canEdit`、`canApplySuggestion`、`canUndo` 和 `canRedo` 必须为 false。
- draft 有 pending edit 或 `saveState` 不是 `saved` 时，`canApplySuggestion`、`canInvokeAgent`、`canUndo` 和 `canRedo` 必须为 false；输入和重试仍由外层状态决定。
- `canAnnotate=true` 只表示外层已经提供合法的 annotation command；组件不直接请求 API。
- capability 只控制可用动作，不能用来掩盖错误传入的机器数据。`focusRequest` 使用稳定 request id；父组件通过 model 驱动定位，不调用 `defineExpose`。

## 4. Overlay 身份与坐标

```ts
type DocumentSurfaceTarget =
    | {kind: "revision"; revisionId: string; bodyFingerprint: Fingerprint}
    | {kind: "draft"; draftSessionId: string; authoritativeGeneration: number; workingVersion: number; bodyFingerprint: Fingerprint};

type RuleHitOverlay = {
    id: string;
    span: {start: number; end: number} | null;
    quote: string;
    ruleId: string;
    source: "machine-scan" | "machine-llm-review" | "draft-preview";
    severity: string;
};

type HeatmapOverlay = {
    id: string;
    detector: DetectorIdentityDto;
    chunks: Array<{start: number; end: number; pAi: number}>;
};

type AnnotationOverlay = {
    id: string;
    span: {start: number; end: number};
    quote: string;
    note: string;
};

type DraftChangeOverlay = {
    editId: string;
    span: {start: number; end: number};
    beforeText: string;
    afterText: string;
    source: DraftEditSourceDto;
    state: "applied" | "stale";
};

type DocumentSurfaceOverlays = {
    target: DocumentSurfaceTarget;
    ruleHits: RuleHitOverlay[];
    heatmaps: HeatmapOverlay[];
    activeHeatmapId: string | null;
    annotations: AnnotationOverlay[];
    draftChanges: DraftChangeOverlay[];
};
```

组件在渲染前必须校验 `overlays.target` 与 `document` 完全一致。identity 不同、generation 过期、fingerprint 不同或 span 越界的 overlay 必须隔离并上报诊断，不能勉强画到正文上。

所有正文坐标使用 JavaScript UTF-16 半开区间。第一版按原始纯文本渲染，不执行 Markdown 或内嵌 HTML。换行和 Unicode 不能在组件内标准化。

机器 overlay 由 query adapter 提供：

- blind-review 阶段的 revision model 中，规则命中和 heatmaps 必须为空。
- inspect-edit 阶段查看 revision 时，overlay 锚定该 revision。
- inspect-edit 阶段编辑 draft 时，规则、heatmap、annotation 或 suggestion 只有经过确定性坐标投影后才能锚定当前 authoritative generation、working version 和 body fingerprint；失配项标记 stale 并从正文层移除。

## 5. 首次阅读与盲评模式

外层传入 `RevisionSurfaceDocument`，正文表面居中并保持稳定阅读行宽。此时：

- 正文不可编辑。
- 用户可以选择文本、复制，并在选区上创建自然语言评价。
- 页面不显示规则命中、风险分、热力图、机器 diff、Agent 能力或其他机器侧线索。
- 评分表、提交、跳过和揭示由 `BlindReviewStage` 持有，不进入编辑器组件。
- 提交评价失败不清空正文选区和未提交评分。
- 已保存批注立即投影回同一 revision，但不会自动推断 rule id。

owner 流程与未来 Arena 流程都可以使用此模式。二者只复用 UI intent：

```ts
type AnnotationIntent = {
    revisionId: string;
    span: {start: number; end: number};
    quote: string;
    note: string;
};
```

owner adapter 将 intent 发送到 owner annotation API；Arena adapter 必须使用 assignment-scoped API。组件不得拼接 endpoint，也不得把 owner 的 `Revision.revealedAt` 当 Arena exposure。

## 6. 查看与修改模式

blind judgment 或显式 skip 成功、随后 reveal 成功后，工作区进入 `inspect-edit`。外层把正文表面从居中布局移到左侧，并显示右侧工作面板。

进入该阶段时可以有两种文档状态：

1. 只读 revision：展示已揭示的机器报告和 overlay，还没有打开草稿。
2. 可编辑 draft：展示 DraftSession 派生正文，用户、规则和 Agent 的修改都写入同一 edit ledger。

从 revision 开始修改时，外层先执行 `open-draft(baseRevisionId)`，取得 DraftSession 后再把组件切换为 `draft`。组件不得直接把 revision body 变成可写字符串。

保存草稿后：

- 服务器创建新的 immutable Revision 并把它设为线性 head。
- 工作区自动选中新 revision。
- 新 revision 立即进入自己的 `blind-review` 阶段；机器任务可以在后台继续。
- 用户完成盲评或跳过后，才揭示该 revision 的机器结果并回到 `inspect-edit`。

## 7. 选区与批注

```ts
type DocumentSurfaceSelection = {
    target: DocumentSurfaceTarget;
    start: number;
    end: number;
    quote: string;
};
```

- 折叠光标不产生 selection。
- 选区必须落在当前 body 内，quote 必须等于 `body.slice(start, end)`。
- selection 是组件局部 UI 状态；变化时发出 `selection-change`，外层可保存最近选区供 AgentComposer 使用，但不能反向覆盖组件正在进行的原生 selection。
- blind-review 的选区菜单只提供“添加评价”和复制。
- inspect-edit 的 revision 选区可以提供添加评价和“基于此处开始修改”。
- inspect-edit 的 draft 选区可以提供 Agent、格式与编辑动作；第一版不把 draft-only 评论伪装成 revision annotation。
- annotation 保存时必须再次核对 target identity 和 quote；正文或 working version 已变化时要求用户重新选择。失败的 pending annotation 由外层按 revision/target/quote 保存，组件不持有持久队列。

## 8. 草稿输入合同

组件把一次用户输入表达为相对当前 working body 的 splice，不提交服务器 generation 或 provenance：

```ts
type UserDraftEditIntent = {
    draftSessionId: string;
    workingVersion: number;
    from: number;
    to: number;
    insertedText: string;
    inputKind: "typing" | "paste" | "cut" | "format";
};
```

外层 DraftSession controller 立即把 splice 应用到受控 working body并递增 working version，再按产生顺序排队。每次只发送队首；发送时以服务器最近确认的 generation 组装 `ApplyUserDraftEditRequest.expectedGeneration`。前一项成功后使用返回的完整 DraftSession 推进 authoritative identity，再发送下一项。响应乱序、identity 不符或 generation 过旧时不得覆盖 working body。

输入法 composition 期间只更新 composition UI；`compositionend` 最多产生一个 splice。连续 typing 可以在发送前合并，但不能跨 composition、paste、cut、format 或已发送边界。autosave 失败时队列冻结且 working body 保留；重试从同一 authoritative generation 继续。commit、Agent、规则 suggestion、undo 和 redo 只在队列为空且 saveState=saved 时可用。

服务器生成稳定 edit id、坐标、fingerprint 和 `source={kind:"user"}`。undo/redo、规则 suggestion 和 Agent proposal 不走 `UserDraftEditIntent`，由各自 Workspace command 验证 authoritative identity并返回完整下一代 DraftSession。critic apply 等待独立 candidate/权限合同，不在首轮暴露。

## 9. 多 AIGC 检测器与热力图

一个 revision 可以拥有多个 `HeatmapOverlay`，每项必须包含完整 DetectorIdentity。组件每次只绘制 `activeHeatmapId` 对应的一层背景色：

- 右侧面板列出所有可用 detector/run，并显示 name、version、chunkChars、aggregationVersion 和状态。
- 默认选择来自用户对该 revision 的上次选择；没有偏好时可以选择服务器声明的 primary detector。
- 禁止按数组第一项选择。
- 不同 detector 的 chunks 不合并、不求平均、不叠成一张伪热力图。
- 切换 heatmap 不重新运行 detector，也不改变 D5 primary policy。
- 热力图用背景色；规则命中用下划线或边线；批注使用独立标记。颜色不能是唯一编码。

未来若需要并排比较两张热力图，应由工作区提供两个同步的正文表面或专门比较视图，不能在同一文字层叠加两个概率场。

## 10. 组件事件

```ts
type DocumentEditorSurfaceEvent =
    | {type: "selection-change"; selection: DocumentSurfaceSelection | null}
    | {type: "create-annotation"; intent: AnnotationIntent}
    | {type: "apply-user-edit"; intent: UserDraftEditIntent}
    | {type: "request-open-draft"; revisionId: string}
    | {type: "request-undo"; draftSessionId: string; authoritativeGeneration: number}
    | {type: "request-redo"; draftSessionId: string; authoritativeGeneration: number}
    | {type: "request-agent"; target: DocumentSurfaceTarget; selection: DocumentSurfaceSelection | null}
    | {type: "focus-rule-hit"; hitId: string}
    | {type: "select-heatmap"; heatmapId: string}
    | {type: "toggle-overlay"; overlay: "ruleHits" | "heatmap" | "annotations" | "draftChanges"; enabled: boolean};
```

所有持久化事件都由外层映射为现有 `WorkspaceCommand`。selection-change 只同步会话意图，不属于持久事实。组件不能调用 `$fetch`、Prisma、Agent composable 或兄弟面板 ref。

## 11. 排版和响应式

- blind-review：正文列在可用区域居中；评分入口可由外层放入隐藏侧栏或抽屉，展开时不能改变正文字符坐标。
- inspect-edit：正文表面占左侧主列，右侧显示一个工作面板。
- 右侧 panel 切换、评分抽屉展开和 overlay 开关不能重建正文状态或丢失选区。
- 正文使用适合长时间阅读的比例字体和稳定行宽；代码、identity 与分数使用等宽字体。
- 字号不随视口宽度缩放。
- 窄屏可以把右侧面板变为 sheet；正文 identity、authoritative generation、pending edit 数和 saveState 必须始终可见。

## 12. 第一版实现底层

第一版使用精确保留源文本的受控纯文本表面：输入层负责原生选择、IME 和编辑，overlay 层使用相同字体、padding、行高和换行规则。理由：

- 服务端 MachineScan、MachineDetect、annotation 和 DraftEdit 均使用源正文 UTF-16 坐标。
- 当前 `HighlightedTextarea` 已验证输入层与 overlay 背板同步方案。
- 当前 `ReviewEditor` 的 Tiptap preview 已停用，Markdown DOM 与源文本坐标映射没有目标合同。

Tiptap 可以继续作为迁移代码存在，但不能成为新组件的正文真相源。未来启用富文本或 Markdown 渲染前，必须先建立源码位置与视图位置的可逆映射合同。

## 13. 现有组件迁移

第一版从现有实现提取能力，不保留现有所有权：

- `HighlightedTextarea.vue`：保留输入、选择、定位和 overlay 背板能力，改为受控底层。
- `AnnotatableRevisionText.vue`：把选区反算和 annotation 表单迁到统一 intent；删除组件内 `$fetch`。
- `ReadOnlyHighlightedText.vue`：其分段和热力颜色逻辑可复用，但不再作为平行正文真相源。
- `ReviewEditor.vue`：迁移选区菜单、批注、diff 导航和可访问性能力；不迁移内部持久状态和 Tiptap preview 债务。
- `TextPanel.vue`：`RepairPlan` 提升到 DraftSession owner；删除约 20 个跨层 `defineExpose` 命令，由 model、intent 和 Workspace command 替代。

迁移可以先用 adapter 包裹旧组件，但新页面和面板只能依赖本规格的 model/event。

## 14. 明确延后

本轮不设计或实现：

- 历史 revision 浏览器。
- 任意 baseline 选择。
- 跨 revision 比较旅程。
- 左右双栏 diff。
- 富文本协作编辑。
- 多人同时编辑。

未来版本比较使用正文内联 diff，不采用左右双栏；具体交互必须另立 Draft spec 后才能进入实现。

## 15. 验收

1. 同一个组件在 revision 与 draft 两类文档之间切换，正文 identity 和坐标不丢失。
2. blind-review 能选区、复制和添加评价，DOM、model 和网络都没有机器 overlay。
3. revision 文档无法产生正文修改事件。
4. draft 输入即时更新 working body；服务器成功后才推进 authoritative generation，旧响应不能覆盖新正文。
5. overlay target 与当前文档 identity、working version、fingerprint 不一致或 span 越界时不渲染并上报诊断。
6. 多 detector 全部可见；正文只绘制明确选择的一张热力图，选择不依赖数组顺序。
7. Rules/Agent 的定位通过 model/event 完成，没有组件 ref 或 DOM 查询联动。
8. 中文输入法 composition、粘贴、剪切、撤销和重做不会产生重复或错位 edit；autosave 失败后 working body 可重试或复制。
9. 保存草稿创建新 revision 后，组件回到该 revision 的 blind-review 只读状态。
10. 历史浏览和版本比较没有空壳按钮、伪数据或不可用 tab。