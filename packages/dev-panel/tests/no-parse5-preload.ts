/**
 * 测试用的 Bun preload：任何代码加载 parse5 就直接失败。用来确认 `status` 等读取路径没有加载页面解析器（只有发布路径按需导入它）。
 */
Bun.plugin({
    name: "forbid-parse5",
    setup(build) {
        build.onLoad({filter: /[\\/]node_modules[\\/]parse5[\\/]/u}, () => {
            throw new Error("parse5 不该在这条路径上加载");
        });
    },
});
