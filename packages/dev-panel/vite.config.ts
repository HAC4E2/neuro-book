import {resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vite";

/** 面板前端：根是 src/web，产物进 dist/web（不入库，`nbdev panel serve` 发现输入变了就构建，见 docs/panel.md）。 */
export default defineConfig({
    root: resolve(import.meta.dirname, "src/web"),
    base: "/",
    plugins: [vue(), tailwindcss()],
    build: {
        outDir: resolve(import.meta.dirname, "dist/web"),
        emptyOutDir: true,
        // 面板只在本机开，产物大小不是问题；单个大块比一堆小块少几次往返。
        chunkSizeWarningLimit: 2_000,
    },
});
