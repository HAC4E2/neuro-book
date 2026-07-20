/**
 * 内置 workflow：拆书（Task 111 验收样板）。
 *
 * 读取书稿 → 逐章并发摘要（researcher ×N）→ 剧情合并分析 → 返回结构化拆书结果。
 * - 通过 wf.workspace.read 读当前 Project Workspace 的书稿（与 read 工具同一套路径语义）；
 * - 每章一个 ephemeral session，run 成功后自动归档；
 * - wf.chart 全程构图：起点 → 逐章扇出 → 汇入分析 → 完成。
 *
 * 注意：workflow 源码不允许 import；所有能力走 wf API（见 reference/agent/workflow/）。
 */
export default {
    key: "split-book",
    title: "拆书",
    description: "读取书稿文件，逐章并发生成摘要，再合并做剧情结构分析，返回结构化拆书结果。",
    whenToUse: "用户想拆解/分析一本书稿的章节结构与剧情脉络时（例如「帮我拆这本书」「分析这部小说的结构」）。",
    argsHint: [
        {name: "path", label: "书稿路径（Project 相对，如 manuscript/book.md）", defaultValue: "manuscript/book.md"},
        {name: "maxChapters", label: "最多处理章数", defaultValue: "8"},
    ],
    phases: [
        {key: "read", title: "读取并切章"},
        {key: "brief", title: "逐章并发摘要"},
        {key: "analyze", title: "剧情合并分析"},
    ],
    run: async (wf: any, args: any) => {
        const path: string = args?.path || "manuscript/book.md";
        const maxChapters: number = Math.max(1, Math.min(Number(args?.maxChapters) || 8, 30));
        const profileKey: string = args?.profileKey || "researcher";

        wf.progress({phase: "read"});
        wf.chart.node("read", "读取书稿");
        wf.chart.enter("read");
        const raw = await wf.workspace.read(path);
        // 切章：优先按 markdown 标题行（#/## 开头）切，切不出再按分隔线，最后整本当一章
        let parts: string[] = raw.split(/\n(?=#{1,3}\s)/u).filter((p: string) => p.trim().length > 0);
        if (parts.length <= 1) parts = raw.split(/\n-{3,}\n/u).filter((p: string) => p.trim().length > 0);
        const dropped = Math.max(0, parts.length - maxChapters);
        const chapters = parts.slice(0, maxChapters).map((text: string, i: number) => ({
            id: `ch${i + 1}`,
            heading: (text.split("\n")[0] || `第 ${i + 1} 段`).replace(/^#+\s*/u, "").slice(0, 40),
            text,
        }));
        wf.log(`读取 ${path}：切出 ${parts.length} 章，处理前 ${chapters.length} 章${dropped > 0 ? `（丢弃 ${dropped} 章）` : ""}`);

        wf.progress({phase: "brief", total: chapters.length});
        let done = 0;
        const briefs = await wf.map(chapters, async (ch: any) => {
            const agent = await wf.agents.create(profileKey, {ephemeral: true, tags: ["workflow:split-book"]});
            const nodeKey = `brief-${ch.id}`;
            wf.chart.node(nodeKey, `${ch.id} ${ch.heading}`);
            wf.chart.edge("read", nodeKey);
            wf.chart.enter(nodeKey, {token: ch.id, sessionId: agent.id});
            const r = await agent.invoke({
                message: [
                    `请为以下章节写摘要，直接输出，不要寒暄：`,
                    `1. 一句话概括（不超过 40 字）`,
                    `2. 关键事件列表（每条不超过 25 字）`,
                    `3. 出场人物`,
                    "",
                    ch.text.slice(0, 6000),
                ].join("\n"),
            });
            wf.chart.leave(nodeKey, {token: ch.id});
            wf.chart.node("analyze", "剧情合并分析");
            wf.chart.edge(nodeKey, "analyze", "合并");
            wf.progress({phase: "brief", done: ++done});
            return {chapter: ch.id, heading: ch.heading, brief: r.result.message};
        }, {concurrency: 3});

        wf.progress({phase: "analyze"});
        wf.chart.leave("read");
        const analyst = await wf.agents.create(profileKey, {ephemeral: true, tags: ["workflow:split-book"]});
        wf.chart.move("read", "analyze", {sessionId: analyst.id, label: "汇总"});
        const analysis = await analyst.invoke({
            message: [
                "以下是一本书稿的逐章摘要。请做剧情结构分析，直接输出：",
                "1. 整体主题与类型",
                "2. 剧情主线与阶段划分",
                "3. 主要人物弧线",
                "4. 明显的伏笔或未回收的钩子",
                "",
                ...briefs.map((b: any) => `【${b.chapter} ${b.heading}】\n${b.brief}`),
            ].join("\n\n"),
        });
        wf.chart.node("finish", "完成");
        wf.chart.move("analyze", "finish", {label: "产出"});
        wf.chart.leave("finish");
        wf.log("拆书完成");
        return {
            path,
            chapterCount: chapters.length,
            briefs,
            analysis: analysis.result.message,
        };
    },
};
