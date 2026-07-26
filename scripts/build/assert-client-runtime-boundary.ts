import {readdir, readFile} from "node:fs/promises";
import path from "node:path";

import {initSync, parse} from "es-module-lexer";

/** 从浏览器 JavaScript 中提取 Node 专用模块说明符。 */
export function findNodeModuleSpecifiers(source: string): string[] {
    initSync();
    const [imports] = parse(source);
    return imports
        .map((specifier) => specifier.n)
        .filter((specifier): specifier is string => specifier?.startsWith("node:") === true);
}

/**
 * 验证 Nuxt 客户端产物没有越过浏览器运行时边界。
 *
 * 共享模块误引 Node built-in 时必须让构建失败，不能把坏的 specifier 留给 WebView 运行时。
 */
export async function assertClientRuntimeBoundary(clientRoot = path.resolve(".output", "public", "_nuxt")): Promise<void> {
    const files = await javascriptFiles(clientRoot);
    const violations: string[] = [];
    for (const file of files) {
        const source = await readFile(file, "utf8");
        for (const specifier of findNodeModuleSpecifiers(source)) {
            violations.push(`${path.relative(clientRoot, file)} -> ${specifier}`);
        }
    }
    if (violations.length > 0) {
        throw new Error(`客户端产物包含 Node 专用模块：\n${violations.join("\n")}`);
    }
    console.log(`Client runtime boundary passed (${files.length} JavaScript files)`);
}

/** 递归列出目录中的 JavaScript 产物，保持稳定排序。 */
async function javascriptFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(target);
            } else if (entry.isFile() && entry.name.endsWith(".js")) {
                files.push(target);
            }
        }
    };
    await visit(root);
    return files.sort();
}

if (import.meta.main) {
    await assertClientRuntimeBoundary();
}
