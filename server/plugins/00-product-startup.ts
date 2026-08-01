import {defineNitroPlugin} from "nitropack/runtime";
import {startProductRuntime} from "nbook/server/runtime/product-startup";

// Nitro 2.13 不等待 plugin callback 返回的 Promise；顶层 await 才能阻止服务提前监听。
await startProductRuntime();

/** Product 异步门禁已在模块求值阶段完成，plugin 本身不再启动后台任务。 */
export default defineNitroPlugin(() => undefined);
