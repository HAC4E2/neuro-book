# T76 实现审查报告

基线：`a60eb885..HEAD`。以下问题均基于工作树实际源码与隔离实验；未修改工作树跟踪文件。

### C1 动作异常时通知不会移除，也不会记诊断
- 严重性：重要
- 类别：通知 / 失败恢复
- 位置：`packages/nb-ui/src/components/feedback/NotificationViewport.vue:39-42`
- 现象：`runAction` 先同步执行 `item.action?.run()`，只有正常返回才执行 `remove(item.id)`；`run` 抛错会直接跳出，通知仍留在队列。实现没有传入或调用诊断记录器。
- 为什么是问题：工作台规范要求动作抛错时“通知仍移除，错误记诊断”（`docs/specs/workbench/notifications.md:53-55,82`）。当前实现会留下一个已失败的常驻动作，用户可重复触发，且没有 `workbench.notifications` 诊断。
- 如何验证：用隔离 happy-dom/Vitest 实验挂载真实 `NotificationViewport`，动作抛出 `new Error("boom")`；命令 `bunx vitest run --config <审查目录>/vitest.notification.config.ts`，结果 `Test Files 2 passed, Tests 2 passed`；该用例实际观察到点击抛错且 `service.queue.notifications.value` 仍有 1 条。现有 `notifications.dom.test.ts:46-57` 只覆盖不抛错的动作。
- 建议修复：用 `try/finally` 保证 `remove(item.id)`，在工作台服务注入诊断记录器并在 `catch` 中记录 `workbench.notifications` 后重新抛出或交给 Vue 错误处理；不要静默吞错。

### C2 常驻通知的 `sticky` 状态没有保存，后续省略 sticky 的更新会错误变成限时
- 严重性：重要
- 类别：通知 / 更新状态
- 位置：`packages/neuro-book/src/plugins/workbench/web/notifications.ts:30-53`
- 现象：`notify` 只把 `sticky` 折算成 `duration: 0`，队列项不保存 sticky；`update` 用 `patch.sticky` 作为新状态而不是当前状态。先 `notify({sticky: true})`，再 `handle.update({tone: "success"})` 时，`durationOf` 得到 success 的 `3200` 毫秒。
- 为什么是问题：合同把 `update` 定义为 `Partial<NotificationInput>`，省略字段应保持已有值；规范要求改色调时按“新值”重算常驻，但未改 sticky 不能丢失显式常驻。当前代码会使必须持续显示的通知在一次不相关的色调更新后自动消失。
- 如何验证：从 `packages/neuro-book` 执行 `bun -e 'const {createNotifications}=await import("./src/plugins/workbench/web/notifications.ts"); const n=createNotifications(); const h=n.notify({message:"x", sticky:true}); console.log("before",n.queue.notifications.value[0]?.duration); h.update({tone:"success"}); console.log("after",n.queue.notifications.value[0]?.duration); n.dispose();'`，实际输出 `before 0`、`after 3200 success`。现有 `notifications.dom.test.ts:60-71` 显式传了 `sticky:false`，没有覆盖省略 sticky 的 patch。
- 建议修复：在工作台通知项或队列项保留 sticky 状态；更新时以 `patch.sticky ?? current.sticky` 合并，并只在调用方明确改 sticky 时改变常驻语义。

### C3 通知暂停期间更新时长会重启计时，指针仍停留在通知上也会自动消失
- 严重性：重要
- 类别：通知 / 悬停状态
- 位置：`packages/nb-ui/src/composables/useNotification.ts:74-97,118-130`
- 现象：`pause` 只清除 timer，不记录“已暂停”状态；`update` 收到 duration 时无条件调用 `schedule`。因此暂停一条 30ms 通知后更新 duration，再等待 60ms，通知被移除。
- 为什么是问题：视口在 `NotificationViewport.vue:59-60` 鼠标进入时暂停计时，工作台规范要求指针停留期间计时暂停。通知更新（例如动作/色调或服务端状态变化）不应绕过这个不变量，否则用户正在阅读时通知消失。
- 如何验证：从 `packages/neuro-book` 执行 `bun -e 'const {createNotificationQueue}=await import("@notnotype/nb-ui/notifications"); const q=createNotificationQueue(); const id=q.notify({message:"x",duration:30}); q.pause(id); q.update(id,{duration:30}); await Bun.sleep(60); console.log("remaining",q.notifications.value.some((item)=>item.id===id)); q.clearAll();'`，实际输出 `remaining false`。
- 建议修复：队列维护 paused 状态；暂停期间更新 duration 只更新 deadline/剩余时长，不注册 timer，直到 resume；从常驻改限时时同样保持暂停。

### C4 作品目录读取失败后打开目录选择器会发送非法空路径
- 严重性：重要
- 类别：书架 / 目录选择流程
- 位置：`packages/neuro-book/src/plugins/projects/web/components/BookshelfHost.vue:135-138`、`packages/neuro-book/src/plugins/projects/web/components/PathPickerDialog.vue:82-88`、`packages/neuro-book/src/plugins/projects/web/shelf-page.ts:305-310`
- 现象：`changeLibrary` 在 `library()` 返回 `null` 时把 `initialPath` 设为 `""`；选择器打开后立即调用 `page.browse("")`。书架适配器把非 `null` 路径编码为 `{path: ""}`，违反远程合同 `browse.path` 的 `minLength: 1`（`packages/neuro-book/src/plugins/projects/shared/contracts.ts:192-195`）。
- 为什么是问题：首次读取作品目录失败时，“更改作品目录”无法从默认起点打开，用户被迫先手工输入合法路径；这正是错误恢复路径，且合同明确规定省略 `path` 才表示缺省作品目录。
- 如何验证：从 `packages/neuro-book` 用真实 `createShelfPage` 与记录请求参数的远程适配器执行 `await page.browse("")`，命令输出 `calls:[{"path":""}]`，而不是省略 `path`；结果为错误文案 `列不出目录：路径无效或不存在`。源码链路确认 `BookshelfHost` 在 `current === null` 时传空字符串。
- 建议修复：把目录选择器的 `initialPath` 允许为 `string | null`，读取失败时传 `null`；保持 `page.browse(null)` 映射成 `{}`，让服务端按合同使用缺省作品目录或其上级。

### C5 目录浏览返回符号链接文本路径，违反真实路径合同
- 严重性：重要
- 类别：服务端 / 目录浏览
- 位置：`packages/neuro-book/src/plugins/projects/backend/browse.ts:79-93`
- 现象：代码已经在 `realpath(child)` 得到 `real` 并用它判断登记状态，但最终 `entries.push` 仍返回 `path: child`，因此目录符号链接返回链接路径而不是目标真实路径。
- 为什么是问题：运行时合同要求 `browse.entries[].path` 是解析符号链接后的真实路径（`docs/specs/runtime/projects.md:119`）。书架选择、登记与后续路径比较会因此拿到不稳定的别名，且 `registered` 判断使用的路径与交给客户端的路径不一致。
- 如何验证：在真实临时目录创建 `target` 和指向它的 `link`，给目标写合法 `.nbook/project.json`，执行 `browseDirectory`；输出中 `link` 条目为 `{"path":"/tmp/.../link","kind":"project"}`，没有返回目标的 `/tmp/.../target`。
- 建议修复：在保留显示名 `entry.name` 的同时把输出路径改为 `real`；对 `realpath` 失败的条目按既有不可列策略处理，不回退到链接文本路径。

### C6 身份文件读取没有大小上限，浏览和书架读取可被任意大文件拖垮
- 严重性：重要
- 类别：服务端 / 输入资源边界
- 位置：`packages/neuro-book/src/plugins/projects/backend/browse.ts:37-49`、`packages/neuro-book/src/server/projects/identity.ts:192-200`
- 现象：目录浏览的 `projectTitle` 与通用 `readProjectIdentity` 都直接 `readFile(..., "utf8")`，再整体 `JSON.parse`；读取前没有 `stat` 大小检查、截断读取或统一的身份文件上限。
- 为什么是问题：用户可控的项目目录中只要放置一个超大 `.nbook/project.json`，每次书架刷新、浏览目录或读取项目元数据都会分配并解析整份文件，造成不必要的内存和延迟压力；“身份文件坏了只影响这一部”不应等于接受无界输入。
- 如何验证：创建真实临时项目并写入约 8 MiB、结构合法的身份 JSON；执行 `browseDirectory`，实际输出 `{"ok":true,"titleLength":8388608}`，证明完整大字段被读取并进入结果，代码没有任何拒绝边界。
- 建议修复：集中定义身份文件最大字节数，在 `readProjectIdentity` 与浏览标题读取前先检查文件大小并将超限视为该作品的 invalid/读取失败；最好复用同一受限读取实现，避免两个入口继续分叉。

### C7 同格式封面写入后更新身份失败会删除原有有效封面
- 严重性：重要
- 类别：服务端 / 封面写入事务
- 位置：`packages/neuro-book/src/plugins/projects/backend/cover-routes.ts:84-97`
- 现象：上传 PNG 时目标固定为 `cover.png`；代码先把临时文件 rename 到目标，随后才调用 `updateMetadata`。如果身份更新失败，统一 `unlink(target)`，当旧身份本来也是 `cover.png` 时，刚替换的新文件和原有旧文件都已是同一个路径，旧封面无法恢复。
- 为什么是问题：规范只要求身份写失败时删除“刚写的文件”，并要求既有封面不因一次失败上传丢失。当前失败结果为 500，但旧封面已不可恢复，用户还会失去原来的可显示数据。
- 如何验证：用真实 Hono 路由、临时项目目录和 `updateMetadata` 固定返回失败；预先写入 `cover.png`，上传合法 PNG，执行 PUT。实际输出 `{"status":500,"oldFileExists":false}`。
- 建议修复：保留旧目标（备份/交换后失败回滚），或先让元数据指向临时新文件并在成功提交后原子替换；失败清理只能删除本次上传的临时/新文件，不能无条件删除原目标。

### C8 封面大小检查发生在完整 multipart 解析之后
- 严重性：重要
- 类别：服务端 / 上传资源边界
- 位置：`packages/neuro-book/src/plugins/projects/backend/cover-routes.ts:71-80`
- 现象：PUT 先执行 `await c.req.formData()`，得到完整 `File` 后才在 `file.size > PROJECT_COVER_MAX_BYTES` 时返回 413；5 MB 限制不是请求体解析阶段的上限。
- 为什么是问题：任意超大 multipart 请求仍会先被解析、缓存或分配，之后才返回“至多 5 MB”；这不能保护服务端的内存和解析成本。规范的 5 MB 限制应覆盖接收过程，而不只是最终文件对象。
- 如何验证：执行真实 Hono 路由上传 `5242881` 字节文件，实际响应为 `413` 与 `{"code":"too-large",...}`；同时源码顺序确认 `formData()` 位于大小判断之前，因此当前测试只证明响应码，不证明解析资源受限。
- 建议修复：在 multipart 读取器上设置硬字节上限并超限中止流；至少先校验可信的 `Content-Length`，并对 chunked 请求使用带上限的流式解析，不能只依赖解析完成后的 `File.size`。

### C9 FileBrowser 重复面包屑名称会导航到错误的路径
- 严重性：重要
- 类别：nb-ui / 目录选择器
- 位置：`packages/nb-ui/src/components/navigation/FileBrowser.vue:68-74`
- 现象：`onCrumb` 用 `props.segments.find((candidate) => candidate.label === item.label)` 按显示文字找段，而不是按点击项的索引或路径找段。路径 `/src/src/app` 中第二个 `src` 点击后会发出第一个 `/src`。
- 为什么是问题：目录名可以重复；选择器会把用户带到错误目录，且没有报错或视觉提示。路径字段本身已经在 `FileBrowserSegment` 合同中提供，不能用非唯一的 label 反查。
- 如何验证：隔离 happy-dom/Vitest 挂载真实 `FileBrowser`，传入 `[/, src=/src, src=/src/src, app=...]`，点击第二个面包屑锚点；命令 `bunx vitest run --testNamePattern='second duplicate breadcrumb' --config <审查目录>/vitest.notification.config.ts`，结果 `1 passed, 2 skipped`，实验实际收到 `navigate` 的参数为 `["/src"]`。
- 建议修复：`crumbs` 保留 segment 索引或直接把 `path` 放进事件数据；点击时按索引取 `props.segments[index].path`，不要按 label 查找。

### C10 Lab 焦点环诊断会把不可聚焦外框的普通溢出误报为 clipped focus ring
- 严重性：建议
- 类别：Lab / CSSOM 选择器重写
- 位置：`packages/neuro-book/src/plugins/lab/web/lab-debug.ts:90-103,124-133`
- 现象：规则 `button:hover, .frame:focus-visible { box-shadow: ... }` 被改写为包含 `.frame:is(*)` 的选择器；随后候选筛选只要命中元素自身可聚焦或含有可聚焦后代就保留。一个没有 `tabindex` 的 `.frame`（仅包含 button）因此被当成可能画 `:focus-visible` 外框，尽管 `:focus-visible` 直接作用在 `.frame`，子 button 聚焦不会匹配它。
- 为什么是问题：Lab 的诊断结果会报告不存在的焦点环裁剪，干扰截图/组件验收；注释只对 `:focus-within`、`:has(...:focus-visible)` 这类外框选择器允许按后代推断，不能把直接 `:focus-visible` 也按同一规则处理。选择器列表中带 hover 分支还会扩大静态匹配面。
- 如何验证：隔离 happy-dom/Vitest 注入真实 CSSOM 规则、不可聚焦 `.frame`、内部 button 与 overflow-hidden 裁剪容器，再调用真实 `measureStage`；命令 `bunx vitest run --testNamePattern='non-focusable direct focus' --config <审查目录>/vitest.notification.config.ts`，结果 `1 passed, 2 skipped`，`clippedFocus` 实际长度为 `1`。
- 建议修复：解析改写后的选择器语义，只有 `:focus-within`、`:has()` 等明确把焦点传递给外框时才允许后代可聚焦判断；直接 `:focus`/`:focus-visible` 只接受自身可聚焦元素，并按 selector-list 分支分别处理。

### C11 书架集成测试用替代能力隐藏了工作台服务与页面寿命差异，关键回归场景未锁定
- 严重性：建议
- 类别：测试 / 集成边界
- 位置：`packages/neuro-book/src/plugins/projects/projects.test.ts:123-143`、`packages/neuro-book/src/plugins/projects/shelf-page.test.ts:1-5`
- 现象：`projects.test.ts` 明确不装 `nbook.workbench` 插件，直接以 `createNotifications()` 作为 `notificationsKey` 能力；`shelf-page.test.ts` 的远程 `projects` 也由 `shelfProvider` 按剧本回答。这样覆盖了通知队列和书架模型，但没有覆盖真实工作台服务注册、窗口入口 abort 清空、页面根挂载视口及真实远程合同返回的组合行为。
- 为什么是问题：实现已经出现 C1、C2 所涉及的视口/服务差异，但现有集成测试不会捕获它们；同时 `notifications.dom.test.ts` 未覆盖动作抛错，`FileBrowser.test.ts` 未覆盖重复面包屑，`cover-routes.test.ts` 未覆盖同格式更新失败保留旧文件或解析前超限，测试绿并不能证明这些边界。
- 如何验证：读取上述测试装配并执行已允许的定向测试；`projects.test.ts` 的能力列表没有工作台插件，只有行 135 的 `createNotifications`；改动测试中未发现 `vi.mock`、`spyOn`、`useFakeTimers` 或跳过断言，缺口来自真实装配未进入测试而非模拟 API 误用。
- 建议修复：保留当前快速模型测试，再补少量真实工作台入口级测试：安装实际 `nbook.workbench`、挂载 `NotificationViewport`，验证页面切换不清空、入口 abort 清空；为上述动作异常、sticky 省略更新、重复面包屑、封面失败回滚增加回归用例。超限测试应同时验证请求接收边界，而不只断言 413。

## 验证记录

- `packages/neuro-book`：`bun test ./src/server/user-directories.test.ts ./src/server/projects/identity.test.ts ./src/server/projects/registry.test.ts ./src/plugins/projects/backend/cover-routes.test.ts ./src/plugins/projects/projects.test.ts`，结果 `50 pass, 0 fail, 273 expect() calls`。
- `packages/neuro-book`：`bun run typecheck` 通过；随后定向 Bun 测试结果 `12 pass, 0 fail, 128 expect() calls`。该命令中的 `*.dom.test.ts` 由 `bunfig.toml` 排除，实际只由 Bun 执行了 `shelf-page.test.ts`，DOM 组件不是这条结果的覆盖范围。
- `packages/nb-ui`：`bun run typecheck` 通过，包含 Nuxt prepare、库类型检查与 playground 类型检查。
- 隔离实验（配置、缓存与用例均在本报告目录）：通知动作异常、重复面包屑、Lab 焦点环误报共 `3 passed`；单独筛选时各为 `1 passed, 2 skipped`。
- 按用户限制未运行 e2e、Playwright、开发服务或构建。
- 尝试运行真实 NeuroBook Vitest DOM 配置：`bunx vitest run --config vitest.config.ts ...`，7 个选定文件均在 setup 阶段失败、`0 test`；错误原文为 `Cannot find module '/@fs<worktree>/packages/neuro-book-test-support/src/vitest.ts'`。因此真实 DOM 套件结果不可用，不能把它记为通过；报告中的 DOM 观察来自隔离配置实验。

## 各级数量

- 阻断：0
- 重要：9
- 建议：2
- 合计：11
