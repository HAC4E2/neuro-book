import {readFile} from "node:fs/promises";

const GAXIOS_SOURCE_PATTERN = /[\\/]gaxios[\\/]build[\\/](?:cjs|esm)[\\/]src[\\/]gaxios\.js$/u;
const GAXIOS_NODE_FETCH_IMPORT = "(await import('node-fetch')).default";
const PI_AI_ROOT_PATTERN = String.raw`[\\/]@earendil-works[\\/]pi-ai[\\/]dist[\\/]`;
const PI_AI_BEDROCK_PATTERN = new RegExp(String.raw`${PI_AI_ROOT_PATTERN}api[\\/]bedrock-converse-stream\.lazy\.js$`, "u");
const PI_AI_ENV_KEYS_PATTERN = new RegExp(`${PI_AI_ROOT_PATTERN}env-api-keys\\.js$`, "u");
const PI_AI_OAUTH_PATTERN = new RegExp(String.raw`${PI_AI_ROOT_PATTERN}utils[\\/]oauth[\\/]load\.js$`, "u");

/**
 * 把现代 Bun 已内置的 fetch 投影为 gaxios 的 node-fetch fallback。
 *
 * Bun.build 会有意保留字面量 dynamic import，因此 `onResolve` 无法接管这里；
 * 必须在 gaxios 的稳定源码边界精确改写。上游形状变化时 fail closed，不能把
 * `node-fetch` 留到没有该 package 的 Product 中。
 */
export function productRuntimeCompatibilityPlugin(): Bun.BunPlugin {
    return {
        name: "nbook-product-runtime-compatibility",
        setup(build) {
            build.onLoad({filter: GAXIOS_SOURCE_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                const first = source.indexOf(GAXIOS_NODE_FETCH_IMPORT);
                const second = first < 0 ? -1 : source.indexOf(GAXIOS_NODE_FETCH_IMPORT, first + 1);
                if (first < 0 || second >= 0) {
                    throw new Error(`gaxios node-fetch fallback 形状变化：${args.path}`);
                }
                return {
                    loader: "js",
                    contents: source.replace(
                        GAXIOS_NODE_FETCH_IMPORT,
                        "globalThis.fetch.bind(globalThis)",
                    ),
                };
            });
        },
    };
}

/**
 * 把 pi-ai 为浏览器 bundle 保留的已知变量 import 投影成 Bun Product 的字面量入口。
 * auth/context 的 Node builtin loader 有意保留为唯一 pi-ai opaque seam；其他上游形状
 * 变化必须在 onLoad 中 fail closed，不能随平台 tree-shaking 漂移。
 */
export function productPiAiImportPlugin(): Bun.BunPlugin {
    return {
        name: "nbook-pi-ai-runtime-imports",
        setup(build) {
            build.onLoad({filter: PI_AI_BEDROCK_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                return {
                    contents: replaceRequired(
                        source,
                        'return import(__rewriteRelativeImportExtension(runtimeSpecifier));',
                        'return import("./bedrock-converse-stream.js");',
                        args.path,
                    ),
                    loader: "js",
                };
            });
            build.onLoad({filter: PI_AI_ENV_KEYS_PATTERN}, async (args) => {
                let source = await readFile(args.path, "utf8");
                for (const [specifier, literal] of [
                    ["NODE_FS_SPECIFIER", "node:fs"],
                    ["NODE_OS_SPECIFIER", "node:os"],
                    ["NODE_PATH_SPECIFIER", "node:path"],
                ] as const) {
                    source = replaceRequired(
                        source,
                        `dynamicImport(${specifier})`,
                        `import(${JSON.stringify(literal)})`,
                        args.path,
                    );
                }
                return {contents: source, loader: "js"};
            });
            build.onLoad({filter: PI_AI_OAUTH_PATTERN}, async (args) => {
                const source = await readFile(args.path, "utf8");
                const replacement = [
                    'export const loadAnthropicOAuth = async () => (await import("./anthropic.js")).anthropicOAuth;',
                    'export const loadOpenAICodexOAuth = async () => (await import("./openai-codex.js")).openaiCodexOAuth;',
                    'export const loadGitHubCopilotOAuth = async () => (await import("./github-copilot.js")).githubCopilotOAuth;',
                ].join("\n");
                const start = source.indexOf("export const loadAnthropicOAuth");
                const endMarker = "//# sourceMappingURL=load.js.map";
                const end = source.indexOf(endMarker);
                if (start < 0 || end < start) throw new Error(`pi-ai OAuth loader 形状变化：${args.path}`);
                return {contents: `${source.slice(0, start)}${replacement}\n${source.slice(end)}`, loader: "js"};
            });
        },
    };
}

/** 精确替换一处上游动态 import；缺失或重复都说明依赖形状已经变化。 */
function replaceRequired(source: string, search: string, replacement: string, filePath: string): string {
    const first = source.indexOf(search);
    const second = first < 0 ? -1 : source.indexOf(search, first + search.length);
    if (first < 0 || second >= 0) throw new Error(`pi-ai runtime import 形状变化：${filePath}`);
    return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}
