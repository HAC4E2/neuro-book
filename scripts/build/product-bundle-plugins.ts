import {readFile} from "node:fs/promises";

const GAXIOS_SOURCE_PATTERN = /[\\/]gaxios[\\/]build[\\/](?:cjs|esm)[\\/]src[\\/]gaxios\.js$/u;
const GAXIOS_NODE_FETCH_IMPORT = "(await import('node-fetch')).default";

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
