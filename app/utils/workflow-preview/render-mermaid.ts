/**
 * mermaid 惰性单例渲染器（workflow preview 专用）。
 * 图源全部来自服务端投影（trace / CFG / skeleton / session 树），前端只负责渲染字符串。
 */
let mermaidReady: Promise<typeof import("mermaid")["default"]> | null = null;
let renderCount = 0;

async function loadMermaid() {
    if (!mermaidReady) {
        mermaidReady = import("mermaid").then((mod) => {
            mod.default.initialize({startOnLoad: false, theme: "neutral", flowchart: {curve: "basis"}});
            return mod.default;
        });
    }
    return mermaidReady;
}

/** 渲染 mermaid 源码为 SVG 字符串；语法错误时返回带错误信息的占位（不抛出） */
export async function renderMermaidSvg(code: string): Promise<string> {
    try {
        const mermaid = await loadMermaid();
        const {svg} = await mermaid.render(`wf-mermaid-${renderCount++}`, code);
        return svg;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `<pre style="color:#b45309;font-size:12px;white-space:pre-wrap;">mermaid 渲染失败: ${message.replaceAll("<", "&lt;")}</pre>`;
    }
}
