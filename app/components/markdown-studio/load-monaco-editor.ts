export type MonacoEditorApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

type MonacoWorkerCtor = {
    new (): Worker;
};

let monacoLoader: Promise<MonacoEditorApi> | null = null;

/**
 * 配置 Monaco 的 worker 工厂。
 * 当前工作区文本编辑统一走 editor worker。
 */
const ensureMonacoEnvironment = (editorWorker: MonacoWorkerCtor): void => {
    globalThis.MonacoEnvironment = {
        getWorker() {
            return new editorWorker();
        },
    };
};

/**
 * 按需加载 Monaco ESM 入口，绕开 Vite 对 monaco-editor 整包预构建。
 */
export const loadMonacoEditor = async (): Promise<MonacoEditorApi> => {
    if (!monacoLoader) {
        monacoLoader = (async () => {
            const [
                monacoModule,
                _markdownContribution,
                _jsonContribution,
                _javascriptContribution,
                _typescriptContribution,
                _cssContribution,
                _htmlContribution,
                _xmlContribution,
                _yamlContribution,
                editorWorkerModule,
            ] = await Promise.all([
                import("monaco-editor/esm/vs/editor/editor.api.js"),
                import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
                import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
                import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
                import("monaco-editor/esm/vs/editor/editor.worker.js?worker"),
            ]);

            ensureMonacoEnvironment(editorWorkerModule.default);
            return monacoModule;
        })();
    }

    return monacoLoader;
};
