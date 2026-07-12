/** Vite 的 `?worker` 导入在 Nuxt 的 typecheck 配置中需要显式声明。 */
declare module "*?worker" {
    const worker: {new (): Worker};
    export default worker;
}
