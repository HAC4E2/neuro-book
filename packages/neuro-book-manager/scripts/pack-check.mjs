import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {resolveAgentCacheRoot} from "@notnotype/neuro-book-test-support/paths";

const packageRoot = resolve(import.meta.dir, "..");
// 仅使用系统受控 cache；pack 产物可回收，不污染仓库 `.agent/tmp`。
const managedTmpRoot = resolveAgentCacheRoot("manager-pack");
await mkdir(managedTmpRoot, {recursive: true});
const temporaryRoot = await mkdtemp(join(managedTmpRoot, "run-"));

try {
    await run(["bun", "pm", "pack", "--destination", temporaryRoot], packageRoot);
    const archiveName = (await readdir(temporaryRoot)).find((name) => name.endsWith(".tgz"));
    if (!archiveName) throw new Error("bun pm pack 没有生成 tgz。" );
    const archive = join(temporaryRoot, archiveName);
    await writeFile(join(temporaryRoot, "package.json"), "{\"private\":true}\n", "utf8");
    await run(["bun", "add", archive, "--cwd", temporaryRoot], temporaryRoot);
    const installedPackageRoot = join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager");
    const packageJson = JSON.parse(await readFile(join(installedPackageRoot, "package.json"), "utf8"));
    const forbidden = ["nuxt", "vue", "prisma", "@tiptap/core"];
    for (const name of forbidden) {
        if (packageJson.dependencies?.[name] || packageJson.devDependencies?.[name]) {
            throw new Error(`Manager npm 包错误包含应用依赖：${name}`);
        }
    }
    if (packageJson.dependencies?.["@notnotype/owned-process"]) {
        throw new Error("Manager npm包不应携带私有Owned Process production dependency；实现必须内联进单文件bundle。" );
    }
    if (packageJson.dependencies?.["@notnotype/neuro-book-contracts"]) {
        throw new Error("Manager npm包不应携带私有Contracts production dependency；实现必须内联进单文件bundle。");
    }
    if (!packageJson.dependencies?.blessed) {
        throw new Error("Manager npm包必须声明blessed runtime dependency。");
    }
    const managerEntry = join(installedPackageRoot, "dist", "neuro-book.mjs");
    const managerSource = (await readFile(managerEntry, "utf8")).replace(/^#![^\n]*\n/u, "");
    const managerImports = new Bun.Transpiler({loader: "js"})
        .scanImports(managerSource)
        .filter((record) => record.kind === "import-statement")
        .map((record) => record.path);
    const blessedWidgetImports = ["box", "list", "prompt", "question", "screen"]
        .map((widget) => `blessed/lib/widgets/${widget}.js`);
    for (const widgetImport of blessedWidgetImports) {
        if (!managerImports.includes(widgetImport)) {
            throw new Error(`packed Manager必须从安装依赖加载静态widget：${widgetImport}`);
        }
    }
    const blessedScreen = await Bun.resolve("blessed/lib/widgets/screen.js", installedPackageRoot);
    const blessedPackage = await Bun.resolve("blessed/package.json", installedPackageRoot);
    const blessedRoot = dirname(blessedPackage);
    if (!isPathInside(blessedRoot, blessedScreen)) {
        throw new Error(`blessed screen未从已安装依赖解析：${blessedScreen}`);
    }
    await readFile(join(blessedRoot, "usr", "xterm"));
    const blessedSmoke = join(temporaryRoot, "blessed-smoke.mjs");
    await writeFile(blessedSmoke, `
import {PassThrough} from "node:stream";
import Screen from ${JSON.stringify(pathToFileURL(blessedScreen).href)};

const input = new PassThrough();
const output = new PassThrough();
Object.assign(output, {columns: 80, rows: 24});
const screen = new Screen({input, output, terminal: "neuro-book-missing-terminfo"});
if (screen.tput.terminal !== "xterm") {
    throw new Error("blessed did not load its packaged xterm fallback");
}
screen.destroy();
`, "utf8");
    await run(["bun", blessedSmoke], temporaryRoot);
    const managerVersion = await runCapture([
        "bun",
        managerEntry,
        "--version",
    ], temporaryRoot);
    if (managerVersion.trim() !== packageJson.version) {
        throw new Error(`Manager --version输出错误：${managerVersion.trim()}`);
    }
    const startHelp = await runCapture([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "start",
        "--help",
    ], temporaryRoot);
    if (!startHelp.includes("--no-health-check")) {
        throw new Error("packed Manager缺少start --no-health-check参数。");
    }
    await run([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "status",
        "--help",
    ], temporaryRoot);
    await run([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "instances",
        "config",
    ], temporaryRoot, {
        ...process.env,
        NEURO_BOOK_MANAGER_CONFIG: join(temporaryRoot, "manager-home", "config.json"),
    });
    const installPlanOutput = await runCapture([
        "bun",
        join(temporaryRoot, "node_modules", "@notnotype", "neuro-book-manager", "dist", "neuro-book.mjs"),
        "install",
        "--profile",
        "source-dev",
        "--dir",
        join(temporaryRoot, "dry-run-instance"),
        "--version",
        "0.8.2-canary.cli-route",
        "--yes",
        "--dry-run",
        "--json",
    ], temporaryRoot, {
        ...process.env,
        NEURO_BOOK_MANAGER_CONFIG: join(temporaryRoot, "manager-home", "config.json"),
    });
    const installDryRun = JSON.parse(installPlanOutput);
    if (installDryRun.plan?.action !== "install"
        || installDryRun.plan?.profile !== "source-dev"
        || !installDryRun.preflight?.blockers?.some((blocker) => blocker.code === "release.unsupported")) {
        throw new Error("install --version被顶层Manager版本选项截获。" );
    }
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}

async function run(command, cwd, env = process.env) {
    const child = Bun.spawn(command, {cwd, env, stdout: "inherit", stderr: "inherit"});
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} 退出码 ${exitCode}`);
}

/** 执行真实packed CLI并返回标准输出，用于验证Commander参数路由。 */
async function runCapture(command, cwd, env = process.env) {
    const child = Bun.spawn(command, {cwd, env, stdout: "pipe", stderr: "pipe"});
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`${command.join(" ")} 退出码 ${exitCode}：${stderr || stdout}`);
    return stdout;
}

function isPathInside(parent, child) {
    const remainder = relative(parent, child);
    return remainder === "" || !isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`);
}
