/**
 * `bun:ffi` 的最小环境声明。
 *
 * 生产运行时是 Bun，`bun:ffi` 真实存在；但 typecheck（vue-tsc）跑在 Node 类型环境下，
 * 不引入完整 bun-types（避免 Bun/Node 全局类型冲突），只按仓库实际用到的成员声明。
 * 目前唯一消费方：server/workspace-files/project-root-reparse-windows.ts。
 */
declare module "bun:ffi" {
    /** FFI 参数/返回值类型标记；仅声明本仓库用到的成员。 */
    export const FFIType: {
        readonly pointer: unknown;
        readonly u32: unknown;
    };

    export type FfiSymbolDefinition = {
        args: readonly unknown[];
        returns: unknown;
    };

    /** 打开动态库并绑定符号；符号调用返回 number | bigint，由调用方收窄。 */
    export function dlopen<TSymbols extends Record<string, FfiSymbolDefinition>>(
        library: string,
        symbols: TSymbols,
    ): {
        symbols: {[K in keyof TSymbols]: (...args: unknown[]) => number | bigint};
        close(): void;
    };

    /** 取 TypedArray/Buffer 的底层指针。 */
    export function ptr(view: ArrayBufferView): unknown;
}
