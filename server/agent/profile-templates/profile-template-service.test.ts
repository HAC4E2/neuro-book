import {describe, expect, it} from "vitest";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
    generateProfileTemplateSource,
    parseProfileTemplateSource,
    previewProfileTemplate,
} from "nbook/server/agent/profile-templates/profile-template-service";
import type {ProfileTemplateNodeDto} from "nbook/shared/dto/profile-template.dto";

const VALID_SOURCE = `/** @jsxRuntime automatic */
/** @jsxImportSource nbook/server/agent/prompts */

import {Message} from "nbook/server/agent/prompts";
import {AppendingSet, HistorySet, ProfilePrompt, Watch} from "nbook/server/agent/profiles/simple-profile";
import type {ProfilePromptContext} from "nbook/server/agent/profiles/simple-profile";

export default function Demo(_ctx: ProfilePromptContext<"leader.default">) {
    return (
        <ProfilePrompt>
            <HistorySet>
                <Message role="system">system prompt</Message>
            </HistorySet>
            <AppendingSet>
                <Watch path="scope.studio.workspace" />
                <Message role="human" source="input">hello</Message>
            </AppendingSet>
        </ProfilePrompt>
    );
}`;

describe("profile-template-service", () => {
    it("解析合法 TSX 模板为结构化树", () => {
        const result = parseProfileTemplateSource(VALID_SOURCE);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.root?.type).toBe("ProfilePrompt");
        expect(result.root?.children.map((node) => node.type)).toEqual(["HistorySet", "AppendingSet"]);
    });

    it("校验非法根节点和 Watch path", () => {
        const source = VALID_SOURCE
            .replace("<ProfilePrompt>", "<HistorySet>")
            .replace("</ProfilePrompt>", "</HistorySet>")
            .replace("scope.studio.workspace", "studio.workspace");

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("模板根节点必须是 ProfilePrompt");
        expect(result.issues.map((issue) => issue.message)).toContain("Watch.path 必须以 scope. 开头");
    });

    it("从 AST 生成 TSX 后可再次解析", () => {
        const root: ProfileTemplateNodeDto = {
            id: "root",
            type: "ProfilePrompt",
            props: {},
            editable: true,
            children: [{
                id: "history",
                type: "HistorySet",
                props: {},
                editable: true,
                children: [{
                    id: "message",
                    type: "Message",
                    props: {role: "system"},
                    text: "hello",
                    editable: true,
                    children: [],
                }],
            }],
        };

        const source = generateProfileTemplateSource("demo-template", root);
        const result = parseProfileTemplateSource(source);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.root?.children[0]?.children[0]?.text).toBe("hello");
    });

    it("预览模板会返回消息序列", () => {
        const result = previewProfileTemplate({source: VALID_SOURCE});

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(result.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
            "system:system prompt",
            "system:Watch: scope.studio.workspace",
            "human:hello",
        ]);
    });

    it("保留表达式属性并生成 TSX 表达式", () => {
        const source = VALID_SOURCE.replace(
            '<Watch path="scope.studio.workspace" />',
            '<Reminder id="tasks" watchValue={ctx.scope.agent.tasks} repeatEveryTurns={5}><Message role="system">tasks</Message></Reminder>',
        );

        const result = parseProfileTemplateSource(source);
        const reminder = result.root?.children[1]?.children[0];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(reminder?.props.watchValue).toEqual({kind: "expression", code: "ctx.scope.agent.tasks"});
        expect(generated).toContain("watchValue={ctx.scope.agent.tasks}");
    });

    it("保留 Message 中的 TSX 表达式片段", () => {
        const source = VALID_SOURCE.replace("hello", "{`hello ${ctx.runtime.thread.id}`}");

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[1]?.children[1];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(message?.textKind).toBe("source");
        expect(message?.text).toContain("{`hello ${ctx.runtime.thread.id}`}");
        expect(generated).toContain("{`hello ${ctx.runtime.thread.id}`}");
    });

    it("Message 普通正文允许直接编辑尖括号文本", () => {
        const root: ProfileTemplateNodeDto = {
            id: "root",
            type: "ProfilePrompt",
            props: {},
            editable: true,
            children: [{
                id: "history",
                type: "HistorySet",
                props: {},
                editable: true,
                children: [{
                    id: "message",
                    type: "Message",
                    props: {role: "system"},
                    text: "<system-reminder>\n# 标题\n</system-reminder>",
                    textKind: "text",
                    editable: true,
                    children: [],
                }],
            }],
        };

        const source = generateProfileTemplateSource("demo-template", root);
        const result = parseProfileTemplateSource(source);

        expect(source).toContain('{"<system-reminder>\\n# 标题\\n</system-reminder>"}');
        expect(result.root?.children[0]?.children[0]?.text).toBe("<system-reminder>\n# 标题\n</system-reminder>");
    });

    it("Message 内的小写 JSX 标签按正文处理", () => {
        const source = VALID_SOURCE.replace(
            "hello",
            "<system-reminder># 标题</system-reminder>",
        );

        const result = parseProfileTemplateSource(source);
        const message = result.root?.children[1]?.children[1];
        const generated = generateProfileTemplateSource("demo-template", result.root ?? undefined);

        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        expect(message?.text).toBe("<system-reminder># 标题</system-reminder>");
        expect(generated).toContain('{"<system-reminder># 标题</system-reminder>"}');
    });

    it("Message 节点内不能放 Message 节点", () => {
        const source = VALID_SOURCE.replace(
            '<Message role="system">system prompt</Message>',
            '<Message role="system"><Message role="system">nested</Message></Message>',
        );

        const result = parseProfileTemplateSource(source);

        expect(result.issues.map((issue) => issue.message)).toContain("Message 节点内不能放 Message 节点");
    });

    it("不支持的模板组件会返回源码定位", () => {
        const source = VALID_SOURCE.replace("<Watch path=\"scope.studio.workspace\" />", "<UnknownNode />");

        const result = parseProfileTemplateSource(source);
        const issue = result.issues.find((item) => item.message === "不支持的模板组件：UnknownNode");

        expect(issue?.path).toMatch(/^template\.tsx:\d+:\d+$/);
        expect(issue?.sourceText).toBe("<UnknownNode />");
        expect(issue?.sourceRange?.end).toBeGreaterThan(issue?.sourceRange?.start ?? 0);
    });

    it("Message 外的小写标签会说明应改为正文文本", () => {
        const source = VALID_SOURCE.replace("<Watch path=\"scope.studio.workspace\" />", "<system-reminder />");

        const result = parseProfileTemplateSource(source);
        const issue = result.issues.find((item) => item.message.includes("不支持的模板组件：system-reminder"));

        expect(issue?.message).toContain("小写标签只有放在 Message 正文中才会按文本保留");
        expect(issue?.sourceText).toBe("<system-reminder />");
    });

    it("leader-runtime 模板可以解析为无错误的 ProfilePrompt", async () => {
        const source = await readFile(resolve(process.cwd(), "server/agent/profiles/templates/leader-runtime.tsx"), "utf-8");
        const result = parseProfileTemplateSource(source);

        expect(result.root?.type).toBe("ProfilePrompt");
        expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    });
});
