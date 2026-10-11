# w00017 t75 只读实现审查

审查范围：`f03b3205..HEAD`；已读取提交日志与完整 diff（107 个文件，7124 行新增、444 行删除）。报告持续追加已核实问题，最后按影响排序。

## 问题


### C1
- 严重程度：重要
- 类别：书架刷新并发
- 位置：`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:165-180`
- 现象：`refresh(true)` 在已有 `inFlight` 请求时绕过合并条件，递增序号并立即发出第二个 `shelf()` 请求。第一个请求仍未完成时，页面同时有两个请求在途。
- 为什么是问题：书架合同明确要求同一时间至多一个请求在途；实际服务端请求会被重复执行，旧请求还会被作废，强制刷新并没有取消能力却制造了并发和额外负载。
- 如何核实：已运行真实 Projects 后端与远程链路的仓库外探针，扣住第一个 `shelf` 回复后调用 `refresh(true)`，输出 `REFRESH {"before":2,"after":3,"firstSettled":false}`，旧请求未结束时实际多发一条请求。既有 `bun test ./src/plugins/projects/shelf-page.test.ts` 8 项通过，其中 `shelf-page.test.ts:275-292` 主动断言第二个请求，未守住 Spec 的并发不变量。未在浏览器中复现；浏览器核实可在第一个书架请求未返回时执行会触发强制刷新的作品操作，并观察网络请求重叠。
- 建议改法：强制刷新也只能复用当前请求；若必须在当前请求结束后再取一次，登记一个待刷新标记，在途请求结束后串行启动下一次，不得并发。

### C2
- 严重程度：重要
- 类别：继续写作定位取消与异步竞态
- 位置：`packages/neuro-book/src/plugins/editor/web/area.ts:396-418,586-590`
- 现象：`focusLeft()` 只清理 `focusWhenReady`、`refocusOnRemount`，没有清理 `pendingReveal`。继续写作读取尚未完成时，焦点移到编辑器区外，文档和控件稍后就绪仍会进入 `ready` 分支并排队 `revealEnd()`。即使已进入下一刻回调，回调也只检查 `disposed`，不再确认组、标签、绑定句柄仍然是原目标。
- 为什么是问题：合同要求等待期间窗口停止、切标签或组、关标签、离开编辑器区都取消；迟到的就绪不得移动光标或抢回焦点。当前代码会在用户已去资源管理器或已切换控件后异步抢焦点，继续写作的验收 15 可失败。
- 如何核实：已运行真实 Files 读取与 `ManualClock` 的仓库外探针，慢读期间调用 `focusLeft()`，就绪后输出 `AREA_LEFT {"calls":["reveal","focus"],"focused":false}`；另一次在零刻回调前切到 B，输出 `AREA_SWITCH {"calls":["reveal","focus"],"active":"project://b.md"}`，旧句柄仍被定位和聚焦。既有 `bun test ./src/plugins/editor/area.test.ts` 17 项通过，未覆盖这些边界。未在浏览器中复现；浏览器核实可延迟文档读取后点击资源管理器，或在 ready 至定位回调间切标签，观察迟到的光标与焦点变化。
- 建议改法：取消时清空 `pendingReveal`；下一刻回调重新核对当前组、标签、活动组、文档和控件 token，任一不符即返回。

### C4
- 严重程度：重要
- 类别：新建作品未知结果
- 位置：`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:271-279`
- 现象：新建请求返回 `unknown-outcome` 后刷新书架，只按 `item.title === values.title` 判定成功。不同父目录下已有同名作品时，即使本次请求没有创建或登记目标目录，旧作品也会被误判为本次新建成功。对话框已对书名执行 `trim()`，首尾空白不是可达复现条件。
- 为什么是问题：未知结果必须按本次操作的目标路径核对；书名不是唯一标识。用户会收到成功结果、对话框关闭并选中另一部同名作品，而本次目标目录可能根本没有建成。
- 如何核实：已运行真实后端与远程超时探针，在 `old/同名` 已登记、本次目标为 `new/同名` 时扣住新建请求发送，推进远程时钟使其返回 `unknown-outcome`；链路仍可用、刷新成功，结果为 `ok:true`、选中 id 与旧作品一致、目标不存在。输出见仓库外 `behavior-probe.test.ts` 的“新建结果未知”一项，命令为 `bun test --tsconfig-override ./tsconfig.json <审查目录>/behavior-probe.test.ts -t '结果未知|未知结果'`，4 项通过。未在浏览器中复现；浏览器核实需丢失本次新建请求且让客户端超时，再观察恢复后的同名条目。
- 建议改法：按规范化父目录与服务端生成的目录名精确核对，或由协议提供稳定的目标路径/创建标识；不能按 title 全书架匹配。

### C5
- 严重程度：重要
- 类别：加入已有目录未知结果
- 位置：`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:324-328`
- 现象：`register` 返回 `unknown-outcome` 后虽然刷新书架，但不检查用户输入的目录是否已经登记，直接显示“未完成”通知并结束，也不设置新项目为选中项。
- 为什么是问题：登记是幂等写操作，结果未知时可能已经成功；合同要求按重新取到的书架结果恢复。当前实现会把成功登记报成失败，用户再次操作可能得到重复提示，且不能得到新增条目。
- 如何核实：已运行真实后端与远程超时探针，扣住实际登记成功后的回复，再推进远程时钟；输出 `REMOTE_REGISTER unknown-outcome`、`REGISTER {"found":true,"activeId":null,"notice":{"kind":"unknown-outcome","text":"登记没有完成：unknown-outcome","retry":false}}`。自动刷新成功且包含本次目录，模型仍不恢复成功。命令同 C4，4 项通过。未在浏览器中复现；浏览器核实可在服务端完成登记后丢失回复，让前端超时。
- 建议改法：用输入目录经服务端规范化后的真实路径核对刷新结果；找到后设置 `nextActive`/`activeId` 并返回成功，只有确实不存在才提示未知结果。

### C7
- 严重程度：重要
- 类别：修改作品信息未知结果
- 位置：`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:285-295`
- 现象：`update` 收到远程 `unknown-outcome` 时直接走通用失败分支，不刷新书架、不核对该 id 的服务端作品信息，编辑对话框保留错误提示。
- 为什么是问题：作品信息更新是写操作，回复未知时服务端可能已经原子替换成功。当前页面会把成功改名/改简介报成失败并允许重复提交；刷新前书架还继续显示旧值，违反“结果未知按服务端核对”的恢复要求。
- 如何核实：已运行真实后端与远程超时探针，扣住更新成功后的回复，再推进远程时钟；输出 `REMOTE_UPDATE unknown-outcome`，页面返回 `ok:false`、文案“没有保存：unknown-outcome”，展示 title 仍为 `null`，真实身份文件 title 已为“新书名”。命令同 C4，4 项通过。未在浏览器中复现；浏览器核实可在原子替换完成后丢失更新回复，让前端超时并对照落盘值。
- 建议改法：未知结果时按 id 重新取书架（必要时单独读 metadata），将服务端已匹配输入的结果视为成功并关闭对话框；无法确认才保留输入并提示结果未知。

### C8
- 严重程度：建议
- 类别：统计与 Files 正文上限不一致
- 位置：`packages/neuro-book/src/plugins/projects/project/stats-tracker.ts:578-599`
- 现象：统计只按原始文件字节数 `info.size`/`bytes.length <= TEXT_BUDGET_BYTES` 判定可读，没有执行 Files 服务的 `encodedTextBytes(text) <= TEXT_BUDGET_BYTES` 检查。大量换行、引号或控制字符的文件原始字节数未超限时，统计会计入字数，Files 读取却按 `too-large` 拒绝。
- 为什么是问题：运行时合同要求统计与 Files 使用同一正文上限；书架会显示一部 Files 无法打开的篇数和字数，编辑器随后打开同一文件却失败，统计与用户可编辑内容不一致。
- 如何核实：已运行真实 Files 与统计首扫探针，输入 `"\n".repeat(Math.floor(TEXT_BUDGET_BYTES * 0.6)) + "字"`，得到原始字节数 `589827`、正文编码字节数 `1179653`、预算 `983040`。Files 返回 `too-large`，统计仍计入该文件的 1 字且不计 unreadable。未在浏览器中复现；浏览器核实可观察书架统计后打开同一文件，编辑器读取会失败。
- 建议改法：统计解码后调用共享的 `encodedTextBytes` 判定，超限返回 `unreadable: "too-large"`；或抽出与 Files 共用的正文读取/预算函数，避免两套口径。

### C9
- 严重程度：建议
- 类别：统计与编辑器字数口径
- 位置：`packages/neuro-book/src/plugins/projects/project/stats-tracker.ts:608-612`；对照 `packages/neuro-book/src/plugins/files/backend/files-service.ts:57-65`
- 现象：Files 解码明确以 `ignoreBOM: true` 保留 UTF-8 BOM，统计使用默认解码器把 BOM 去掉，再把结果交给同一个 `countWords`。因此 BOM 位于 YAML frontmatter 前时，统计能识别并排除 frontmatter，而编辑器用 Files 文本调用 `countWords` 会把 frontmatter 里的词计入。
- 为什么是问题：合同要求书架统计与编辑器使用同一字数算法且 frontmatter 不计；同一个带 BOM 的章节在书架和编辑器状态栏显示不同字数。
- 如何核实：已运行真实 Files 与统计首扫探针，输入为 `\uFEFF---\ntitle: Hidden\n---\n正文`。该文件统计为 2 字，Files 返回的文本经 `countWords` 得 4 字；独立解码探针也得 `filesWords:4`、`statsWords:2`。未在浏览器中复现；浏览器核实可打开该章节，对照编辑器状态栏与书架字数。
- 建议改法：统一 BOM 处理：让共享 `countWords` 在算法入口剥除 BOM，或让统计与 Files 都保留同一文本字节后由共享算法处理，并补充 BOM + frontmatter 回归场景。

### C10
- 严重程度：重要
- 类别：书架列表的新鲜度呈现
- 位置：`packages/neuro-book/src/plugins/projects/web/components/ShelfList.vue:44-49`；同样影响 `ShelfTitlePage.vue:41-47`
- 现象：列表行的 `facts()` 对 `none` 只写“尚未统计”，其余只写字数、篇数和最近编辑时间；没有为 `stale` 写“统计于某时”，也没有为 `counting` 写“正在统计”。扉页只处理 `stale` 与 `none`，同样漏掉 `counting`。
- 为什么是问题：高层 `docs/specs/workbench/bookshelf.md:60` 明确要求列表 `stale` 写“统计于某时”、`counting` 写“正在统计”，验收 5 要求 390px 列表仍可见新鲜度；`ShelfList.md:39` 却写 stale 不说明，组件文档与产品 Spec 已冲突，不能用低层文档覆盖产品要求。用户无法区分旧缓存、仍在首扫和完整数据；扉页也漏掉 counting 说明。
- 如何核实：未在浏览器中复现；静态读取组件分支可见只有 `none` 与 `stale` 文案，相关 `ShelfList`/组件测试未覆盖 `counting` 和 `stale` 的新鲜度文案。可用 `freshness: "counting"`、`"stale"` 的条目打开列表/扉页检查文本。
- 建议改法：按 `freshness` 增加 `counting` 文案；`stale` 使用 `computedAt` 格式化“统计于…”，并在列表与扉页共用同一新鲜度格式化函数。

### C11
- 严重程度：重要
- 类别：首页贡献裁决
- 位置：`packages/neuro-book/src/plugins/workbench/web/home-slot.ts:25-50`；`packages/neuro-book/src/plugins/workbench/web/plugin.ts` 的首页接收入口
- 现象：`HomeSlot` 只按 `published` 句柄数量裁决。一个已接受但没有激活的首页声明不计入数量，两个有效声明只有一个发布时会采用已发布者。
- 为什么是问题：`docs/specs/ui/workbench-shell.md:195-198` 要求按已接受声明数量裁决，多个声明全部不采用。实现使首页取决于入口激活时序。
- 如何核实：已运行真实 `createApplication` 探针，接受两个首页声明，一个 `onStartup` 发布，另一个没有激活事件且未激活；启动 available、无 failures，输出 `HOME {"accepted":2,"lazyActivated":false,"selected":"test.live.home"}`。既有 `home-slot.test.ts` 的提供方总在激活时立即发布，遗漏此边界。未在浏览器中复现；浏览器核实可配置两个有效首页声明，仅激活其中一个，观察本应为空工作台的页面仍采用它。
- 建议改法：使用 `context.declarations.list(WORKBENCH_HOME_POINT)` 的已接受声明目录裁决；恰好一个声明且其当前句柄已发布时才采用，多于一个时保持空工作台并记诊断。

### C12
- 严重程度：重要
- 类别：服务端关闭接纳与代次重连
- 位置：`packages/neuro-book/src/server/projects/manager.ts:198-200,291-297`
- 现象：按代次 acquire 只在入口检查一次 `#admission`；`#children.acquire()` 返回之前服务端调用 `stopAdmission()`，仍会交出有效租约。普通 acquire 在等待后检查并释放租约，代次分支遗漏同一收口。
- 为什么是问题：管理器公开合同明确规定接纳关闭后一律拒绝，取得期间关闭的租约立即释放。重连绑定会在服务端停止序列已经开始后成功，并保留本应撤销的租约。
- 如何核实：已运行真实项目子进程探针：先取得 generation 1 并等 ready，发起 `manager.bind({project:id,generation:1}, browser)`，紧接调用 `stopAdmission()`；输出 `ADMISSION {"result":"bound","state":{"generation":1,"state":"running"}}`，绑定返回 `ok:true`。实验随后释放所有租约并停止项目。此条是服务端行为，已运行，不依赖浏览器。
- 建议改法：两种 acquire 共用取得后的接纳复核；关闭时释放得到的租约并返回 `admission-closed`，让 bind 按现有失败映射拒绝重连。

### C13
- 严重程度：建议
- 类别：移出结果未知后的选中恢复
- 位置：`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:297-309`
- 现象：移出先计算了邻居，但 `unknown-outcome` 分支没有设置 `nextActive`；刷新确认目标已消失时返回成功，`activeId` 已被清为 `null`，不选移出前的下一部/上一部。
- 为什么是问题：`docs/specs/workbench/bookshelf.md:69,85` 要求确认移出后选中相邻作品。结果未知但服务端实际成功仍应满足这一状态转换；当前焦点回书架后可能由组件选第一部，跳过原来的邻居。
- 如何核实：已运行真实后端与远程超时探针，登记 A、B、C，选中 B，扣住实际 unregister 成功后的回复，推进时钟；输出 `REMOTE_REMOVE unknown-outcome`，`REMOVE {"result":{"ok":true},"activeId":null,"expected":"<C 的 id>"}`，目标已从列表消失。命令同 C4，4 项通过。未在浏览器中复现；浏览器核实可移出中间作品并丢失回复，观察确认成功后的选中项。
- 建议改法：未知结果核对前保留 `nextActive = neighbour`，确认目标消失后采用仍存在的相邻 id；核对失败则保留当前选中。

## 严重程度统计

- 重要：8（C1、C2、C4、C5、C7、C10、C11、C12）
- 建议：3（C8、C9、C13）
- 阻断：0
- 合计：11
