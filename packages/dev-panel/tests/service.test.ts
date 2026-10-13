import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {existsSync} from "node:fs";
import {chmod, mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {cleanupFixtures, createFixture, run, type Fixture} from "./git-fixture.js";
import {killGroup} from "./processes.js";

/**
 * t11 常驻的管理脚本（L2）：PATH 上的假 systemctl、journalctl 把收到的参数记进日志、按环境变量给退出码；
 * 单元目录在临时的 XDG_CONFIG_HOME 里，单元名是夹具的 `nbdev-panel-main.service`。
 * 不调真实的 systemctl、journalctl：本机正跑着真实的面板服务，不能被测试停掉或重启。
 */

afterEach(async () => {
    await cleanupFixtures();
});

const SCRIPT = join(import.meta.dirname, "..", "src", "service.ts");
const UNIT = "nbdev-panel-main.service";
const LOGIN_HINT = "nbdev panel open --print";

type Prepared = {fixture: Fixture; env: Record<string, string>; log: string; unitPath: string; invoke: (args: string[], extra?: Record<string, string>) => ReturnType<typeof run>};

async function prepare(name: string, options: {installed: boolean}): Promise<Prepared> {
    const fixture = await createFixture(name);
    const bin = join(fixture.root, "fakebin");
    await mkdir(bin);
    const log = join(fixture.root, "calls.log");
    await writeFile(join(bin, "systemctl"), `#!/bin/sh\necho "systemctl $*" >> '${log}'\necho "假 systemctl 的输出"\nexit \${FAKE_SYSTEMCTL_EXIT:-0}\n`);
    // FAKE_JOURNALCTL_BLOCK 时像 `journalctl -f` 一样不退出，收到 SIGTERM 记一笔再退出。
    await writeFile(join(bin, "journalctl"), [
        "#!/bin/sh",
        `echo "journalctl $*" >> '${log}'`,
        "if [ -n \"$FAKE_JOURNALCTL_BLOCK\" ]; then",
        `    trap 'echo "journalctl got SIGTERM" >> '"'${log}'"'; exit 143' TERM`,
        "    while :; do sleep 0.05; done",
        "fi",
        "exit ${FAKE_JOURNALCTL_EXIT:-0}",
        "",
    ].join("\n"));
    await chmod(join(bin, "systemctl"), 0o755);
    await chmod(join(bin, "journalctl"), 0o755);
    const configHome = join(fixture.root, "config");
    const unitPath = join(configHome, "systemd", "user", UNIT);
    if (options.installed) {
        await mkdir(join(unitPath, ".."), {recursive: true});
        await writeFile(unitPath, "# nbdev panel unit (installed by @notnotype/dev-panel)\n");
    }
    const env = {PATH: `${bin}:${process.env.PATH ?? ""}`, XDG_CONFIG_HOME: configHome};
    const invoke = (args: string[], extra: Record<string, string> = {}) => run(process.execPath, [SCRIPT, ...args, "--target", fixture.main], fixture.main, undefined, 30_000, {...env, ...extra});
    return {fixture, env, log, unitPath, invoke};
}

const calls = async (log: string) => (existsSync(log) ? (await readFile(log, "utf8")).trim().split("\n") : []);

describe("服务管理脚本", () => {
    test("没装服务：报 service_not_installed（退出码 5）并提示先 install-service，不调 systemctl、journalctl", async () => {
        const {log, invoke} = await prepare("service-not-installed", {installed: false});
        for (const action of ["status", "start", "stop", "restart", "logs"]) {
            const result = await invoke([action]);
            expect([result.exitCode, result.stderr.includes("[service_not_installed]"), result.stderr.includes("install-service")]).toEqual([5, true, true]);
        }
        expect(await calls(log)).toEqual([]);
    }, 30_000);

    test("status 原样透传输出与退出码；start、stop、restart 发对命令，成功打印一行结果，start、restart 提示重新登录；失败照传退出码", async () => {
        const {log, invoke} = await prepare("service-actions", {installed: true});

        const stopped = await invoke(["status"], {FAKE_SYSTEMCTL_EXIT: "3"});
        expect([stopped.exitCode, stopped.stdout.includes("假 systemctl 的输出")]).toEqual([3, true]);
        expect((await calls(log)).at(-1)).toBe(`systemctl --user status ${UNIT} --no-pager`);

        for (const action of ["start", "stop", "restart"]) {
            const result = await invoke([action]);
            expect(result.exitCode).toBe(0);
            expect((await calls(log)).at(-1)).toBe(`systemctl --user ${action} ${UNIT}`);
            expect(result.stdout.includes(UNIT)).toBe(true);
            expect(result.stdout.includes(LOGIN_HINT)).toBe(action !== "stop");
        }

        const failed = await invoke(["restart"], {FAKE_SYSTEMCTL_EXIT: "6"});
        expect([failed.exitCode, failed.stdout.includes(LOGIN_HINT)]).toEqual([6, false]);
        expect((await calls(log)).length).toBe(5);
    }, 30_000);

    test("logs：缺省 -n 100；--lines、--follow 生效；退出码照传；从 worktree 运行也按主工作区的单元", async () => {
        const {fixture, env, log, invoke} = await prepare("service-logs", {installed: true});

        expect((await invoke(["logs"])).exitCode).toBe(0);
        expect((await invoke(["logs", "--lines", "20", "--follow"])).exitCode).toBe(0);
        expect((await invoke(["logs"], {FAKE_JOURNALCTL_EXIT: "7"})).exitCode).toBe(7);
        const worktree = await fixture.addWorktree("feature", "feat/service");
        const fromWorktree = await run(process.execPath, [SCRIPT, "logs", "--lines", "0", "--target", worktree], worktree, undefined, 30_000, env);
        expect(fromWorktree.exitCode).toBe(0);
        expect(await calls(log)).toEqual([
            `journalctl --user -u ${UNIT} --no-pager -n 100`,
            `journalctl --user -u ${UNIT} --no-pager -n 20 -f`,
            `journalctl --user -u ${UNIT} --no-pager -n 100`,
            `journalctl --user -u ${UNIT} --no-pager -n 0`,
        ]);
    }, 30_000);

    test("用法错误：退出码 2，不调 systemctl、journalctl", async () => {
        const {log, invoke} = await prepare("service-usage", {installed: true});
        for (const args of [[], ["bogus"], ["status", "extra"], ["status", "--follow"], ["start", "--lines", "5"], ["logs", "--lines", "abc"], ["logs", "--lines", "-1"], ["logs", "--json"]]) {
            const result = await invoke(args);
            expect([args, result.exitCode, result.stderr.includes("[usage]")]).toEqual([args, 2, true]);
        }
        expect(await calls(log)).toEqual([]);
    }, 30_000);

    test("logs --follow 前台跟随：脚本被 SIGTERM 结束时把信号转给 journalctl，不留孤儿，退出码照传", async () => {
        const {fixture, env, log} = await prepare("service-follow", {installed: true});
        const child = spawn(process.execPath, [SCRIPT, "logs", "--follow", "--target", fixture.main], {cwd: fixture.main, env: {...process.env, ...env, FAKE_JOURNALCTL_BLOCK: "1"}, stdio: "ignore", detached: true});
        if (child.pid === undefined) throw new Error("服务管理脚本起不来");
        const exited = once(child, "exit");
        try {
            const deadline = Date.now() + 10_000;
            while (!(await calls(log)).some((line) => line.startsWith("journalctl "))) {
                if (child.exitCode !== null) throw new Error(`脚本在启动 journalctl 之前退出了（${child.exitCode}）`);
                if (Date.now() > deadline) throw new Error("10 秒内没有启动 journalctl");
                await sleep(20);
            }
            child.kill("SIGTERM");
            const [code] = await exited;
            expect(code).toBe(143);
            expect(await calls(log)).toEqual([`journalctl --user -u ${UNIT} --no-pager -n 100 -f`, "journalctl got SIGTERM"]);
        } finally {
            killGroup(child.pid);
        }
    }, 30_000);
});
