# Desktop 客户端 `node:crypto` 泄漏修复设计

## 背景

Windows Desktop 启动后的 Nuxt 页面分块 `Cz4oQB0A.js` 可由 Nitro 完整返回，但分块含顶层 `import "node:crypto"`。WebView2 无法解析 Node 专用模块，最终把模块图实例化错误显示为 `Failed to fetch dynamically imported module`。

源头是 `shared/text-to-image-contract-hash.ts` 同时被客户端与服务端共享，却直接同步调用 `node:crypto.createHash()`；`nuxt.config.ts` 又把 `node:crypto` 配成 external，使错误没有在构建期暴露，而是原样进入浏览器产物。

## 方案比较

1. **采用跨运行时同步 SHA-256（选定）**：使用纯 TypeScript 第三方哈希库，保持现有同步 API、规范化输入和 `sha256:<hex>` 输出不变。改动集中、客户端和服务端结果一致。
2. **改用 Web Crypto**：浏览器原生，但 `crypto.subtle.digest()` 是异步 API，会把大量共享合同、常量初始化及服务端调用改成异步，范围和风险都过大。
3. **拆分 client/server 两份实现**：能保留 Node 实现，但会建立条件导入和双实现一致性负担，未来更容易出现哈希漂移。

## 设计

- `shared/text-to-image-contract-hash.ts` 改用跨运行时同步 SHA-256，并继续复用当前 canonical JSON 逻辑。
- 删除 Vite 对 `node:crypto` 的 external 兜底。共享客户端代码误引 Node built-in 时，构建应直接失败，而不是生成运行时坏包。
- 添加聚焦回归：同一规范输入继续产生既定 SHA-256；客户端构建产物不得出现静态 `node:` 模块导入。
- 不修改数据库、用户数据、Provider 配置或桌面 Rust 启动器。

## 验证与打包

1. 先运行回归测试确认旧实现触发失败。
2. 实现后运行聚焦测试与类型检查。
3. 完整执行 Nuxt build，扫描 `.output/public/_nuxt`，确认无 `node:` 静态导入。
4. 执行 Product stage、Desktop assemble，输出 `dist/neuro-book-desktop-x64/NeuroBook.exe`。
5. 使用最终 portable Bun 运行数据库迁移，并启动最终 EXE；通过 HTTP 与 WebView/模块导入证据确认原始 500 不再出现。

## 成功标准

- 规范哈希输出与既有 Node SHA-256 完全一致。
- 客户端分块不含 `node:` 静态导入。
- 最终 EXE 的迁移返回 0、服务可监听、页面入口及对应页面分块可成功加载。
- 新产物位于 `dist`，保留 portable `data` 用户状态目录。
