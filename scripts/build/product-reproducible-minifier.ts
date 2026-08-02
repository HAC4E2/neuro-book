import {transform} from "esbuild";

/**
 * 使用确定性的 esbuild identifier minifier 压缩 Bun 已完成链接的单文件 ESM。
 * Bun 继续拥有模块解析与 splitting；这里不改变 import specifier 或输出文件名。
 */
export async function minifyProductJavaScript(source: string, sourcePath: string): Promise<string> {
    const result = await transform(source, {
        charset: "utf8",
        format: "esm",
        legalComments: "none",
        loader: "js",
        logLevel: "silent",
        minify: true,
        sourcefile: sourcePath,
        sourcemap: false,
        target: "esnext",
    });
    return result.code;
}
