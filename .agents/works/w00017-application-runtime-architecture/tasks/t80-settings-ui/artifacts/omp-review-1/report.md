## C1 窗口关闭后迟到的 page 加载结果仍被缓存并在重开时复用
- 严重度：重要
- 位置：packages/neuro-book/src/plugins/settings/web/settings-window.ts:378-388
- 依据：违反 `docs/specs/settings/settings-window.md` 输出 5 与“时序与寿命”第 145 条：加载结果回来时窗口已关闭必须丢弃，不挂组件、不记为加载失败；重开同一分区应重新按当前窗口生命周期处理。
- 复现或证据：运行真实设置窗口模型场地 `bun /tmp/t80-settings-page-close-check.mts`，实际输出 `{"whileLoading":"loading","afterClosedResult":"ready","hasComponent":true,"loads":1,"afterReopen":"ready"}`。`load()` 的 await 返回后只检查 `generation` 与 `status === "loading"`，没有检查 `open.value` 或当前分区；窗口关闭期间 resolve 的结果被写成 `ready`，重开时不再调用 `load()`。
- 建议的修法：在加载代际中同时记录窗口打开代次或在结果提交前核对窗口仍打开且当前分区仍是该 id；关闭期间的结果作废并清回可重试的等待状态，重开时重新加载。

## 总结
- 条目总数：1（阻断 0，重要 1，建议 0）。
- 跑过的命令与结果：
  - `bun run test:bun`：1051 通过、1 失败；失败是既有 `src/plugins/explorer/actions.test.ts` 的 5 秒超时。随后聚焦重跑 `bun test src/plugins/explorer/actions.test.ts -t '转换：普通目录转为内容文件夹再转回'`：1 通过。
  - `bun run test:vitest`：44 个文件、195 个测试全部通过。
  - `bun run typecheck`：`tsc --noEmit`、`vue-tsc --noEmit -p tsconfig.web.json`、`vue-tsc --noEmit -p tsconfig.browser-test.json` 全部通过。
  - `bun run build && bun run build:e2e`：服务端、网页、`check:dist` 与 e2e 网页产物全部通过；`check:dist` 报告产物不含开发插件与本机路径。
  - `bunx playwright test -c e2e/playwright.config.ts "e2e/settings\\.e2e\\.ts"`：9 个通过。
  - `bunx playwright test -c e2e/playwright.config.ts "e2e/bookshelf\\.e2e\\.ts"`：7 个通过。
  - `bun run docs:check --since a64f9d9b`：无失败、无本次改动警告。
  - `bun run governance:check --since a64f9d9b`：无失败、无本次改动警告。
  - `git diff --check a64f9d9b 28d4e3de`：无输出。
- 没有覆盖到的范围：未跑全量 e2e；未单独做活动栏条目与浮层贡献点的生产浏览器故障注入；未覆盖手机设置窗口、桌面 WebKit、四主题与双配色的完整人工取证；未做验收映射逐条变异检查。全量 Bun 测试的 Explorer 超时未归因于 t80，聚焦重跑通过。
