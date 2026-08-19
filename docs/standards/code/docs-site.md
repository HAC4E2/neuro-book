# VitePress 文档站规范

适用：`vitepress/.vitepress/**` 及 `vitepress/**` 中的主题组件、客户端脚本和样式；普通 Markdown 正文遵循文档治理，不加载源码规范。

- VitePress 是用户文档投影，不承担内部产品规范；页面行为和术语链接回当前 spec 或稳定用户合同。
- 配置、导航和 sidebar 的中英文入口保持对应；外部链接、Reference 过渡链接和静态资源路径必须可构建解析。
- 主题组件遵循前端可访问性、稳定布局和主题变量规则；只修改 TypeScript/Vue/CSS 时追加 [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md) 与 [`frontend.md`](frontend.md)。
- public 资产使用稳定路径和可追溯来源；生成的 `.vitepress/cache` 与 `.vitepress/dist` 由命令产生。
- 修改导航、主题、构建配置或客户端交互后运行 `bun run docs:check`、`bun run docs:build`，用户可见交互追加真实页面验证。

完成标准：中英文导航可达，站内链接和资源构建成功，用户可见组件在目标视口可操作，内部规范没有复制到发布站点独立演进。