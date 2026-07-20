import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterAll, describe, expect, test} from "vitest";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";

/**
 * WorkflowCatalog：双根覆盖 + workflow.ts 转译加载 + 内联编译边界。
 */
describe("WorkflowCatalog", () => {
    const root = resolve(".agent", "workspace", "workflow-catalog-test", randomUUID());
    const systemRoot = join(root, "system");
    const userRoot = join(root, "user");

    afterAll(async () => {
        await rm(root, {recursive: true, force: true});
    });

    async function writeWorkflow(base: string, key: string, title: string): Promise<void> {
        await mkdir(join(base, key), {recursive: true});
        await writeFile(join(base, key, "workflow.ts"), [
            `export default {`,
            `    key: "whatever-inner-key",`,
            `    title: ${JSON.stringify(title)},`,
            `    description: "测试 workflow",`,
            `    whenToUse: "测试",`,
            `    run: async (wf: any) => ({ok: true}),`,
            `};`,
        ].join("\n"), "utf8");
    }

    test("双根覆盖：用户同名目录覆盖系统；目录名是稳定 key", async () => {
        await writeWorkflow(systemRoot, "alpha", "系统版");
        await writeWorkflow(systemRoot, "beta", "系统 beta");
        await writeWorkflow(userRoot, "alpha", "用户版");
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
        const items = await catalog.list();
        expect(items.map((i) => `${i.key}:${i.title}:${i.source}`)).toEqual([
            "alpha:用户版:user",
            "beta:系统 beta:system",
        ]);
        // 文件内 key 被目录名覆盖
        expect((await catalog.get("alpha"))?.def.key).toBe("alpha");
    });

    test("compileInline：合法脚本编译；require 被拒绝", () => {
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
        const def = catalog.compileInline(`export default {key: "adhoc", run: async () => 1};`);
        expect(def.key).toBe("adhoc");
        // 注意：未使用的 import 会被 TS 转译消除，必须真的使用才会触发 require 拒绝
        expect(() => catalog.compileInline(`import fs from "node:fs";\nexport default {key: "x", data: fs.constants, run: async () => 1};`))
            .toThrow(/不允许 import/);
        expect(() => catalog.compileInline(`export default {key: "x"};`)).toThrow(/run 函数/);
    });

    test("bundled 系统 workflow 可加载（split-book 防语法回归）", async () => {
        const catalog = new WorkflowCatalog(resolve("assets", "workspace", ".nbook", "agent", "workflows"), join(root, "nope"));
        const item = await catalog.get("split-book");
        expect(item).not.toBeNull();
        expect(item!.title).toBe("拆书");
        expect(item!.whenToUse).toBeTruthy();
        expect(item!.def.phases?.map((p) => p.key)).toEqual(["read", "brief", "analyze"]);
        expect(typeof item!.def.run).toBe("function");
    });
});
