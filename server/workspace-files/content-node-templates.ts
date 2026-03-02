import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {WorkspaceContentStatus, WorkspaceContentType} from "nbook/server/workspace-files/content-node-schema";

export type WorkspaceContentTemplateInput = {
    title: string;
    type: WorkspaceContentType;
    status: WorkspaceContentStatus;
};

export type WorkspaceContentTemplateBundle = {
    indexContent: string;
    stateContent: string | null;
};

const TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/server/workspace/content-node-templates");

/**
 * 按内容节点类型读取 index.md 模板，并替换基础变量。
 */
export function renderWorkspaceContentTemplate(input: WorkspaceContentTemplateInput): string {
    const templatePath = path.join(TEMPLATE_ROOT, input.type, "index.md");
    return renderTemplateFile(templatePath, input);
}

/**
 * 按内容节点类型读取可选 state.md 模板，并替换基础变量。
 */
export function renderWorkspaceStateTemplate(input: WorkspaceContentTemplateInput): string {
    const templatePath = path.join(TEMPLATE_ROOT, input.type, "state.md");
    if (!fs.existsSync(templatePath)) {
        throw new Error(`内容节点类型 ${input.type} 暂无 state.md 模板`);
    }
    return renderTemplateFile(templatePath, input);
}

/**
 * 读取内容节点 index.md 与可选 state.md 模板。
 */
export function renderWorkspaceContentTemplateBundle(input: WorkspaceContentTemplateInput, includeState: boolean): WorkspaceContentTemplateBundle {
    return {
        indexContent: renderWorkspaceContentTemplate(input),
        stateContent: includeState ? renderWorkspaceStateTemplate(input) : null,
    };
}

/**
 * 读取模板文件并替换基础变量。
 */
function renderTemplateFile(templatePath: string, input: WorkspaceContentTemplateInput): string {
    const template = fs.readFileSync(templatePath, "utf-8");
    return template
        .replaceAll("{{title}}", formatYamlString(input.title))
        .replaceAll("{{status}}", input.status);
}

/**
 * 将字符串格式化为安全的 YAML 标量。
 */
function formatYamlString(value: string): string {
    const trimmedValue = value.trim();
    if (/^[^\s:[\]{},#&*!|>'"%@`][^:[\]{},#&*!|>'"%@`]*$/.test(trimmedValue)) {
        return trimmedValue;
    }
    return JSON.stringify(value);
}
