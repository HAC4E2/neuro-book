import {afterEach, describe, expect, test} from "bun:test";
import {chmod, mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {serviceUnit, serviceUnitName} from "../src/install-service.js";
import {cleanupFixtures, createFixture, run, type Fixture} from "./git-fixture.js";

/** t11 常驻（L2）：单元文件的内容；安装脚本在临时的 XDG_CONFIG_HOME 里写单元、经 PATH 上的假 systemctl 记下命令，不碰真实的用户管理器。 */

afterEach(async () => {
    await cleanupFixtures();
});

const SCRIPT = join(import.meta.dirname, "..", "src", "install-service.ts");

describe("单元文件", () => {
    test("ExecStart 用 bun 的绝对路径加主工作区的 cli.ts（不经 shim）；带 NBDEV_PANEL_UNIT；2、3 不重启；没有 After=default.target", () => {
        const text = serviceUnit({mainRoot: "/home/me/neuro-book", bun: "/usr/bin/bun", port: 4400, artifactPort: 4401, herdrBin: "/home/me/.local/bin/herdr"});
        const lines = text.split("\n");
        expect(serviceUnitName("/home/me/neuro-book")).toBe("nbdev-panel-neuro-book.service");
        expect(lines).toContain("ExecStart=/usr/bin/bun /home/me/neuro-book/packages/dev-panel/src/cli.ts panel serve --port 4400 --artifact-port 4401");
        expect(lines).toContain("Environment=NBDEV_PANEL_UNIT=nbdev-panel-neuro-book.service");
        expect(lines).toContain("WorkingDirectory=/home/me/neuro-book");
        expect(lines).toContain("RestartPreventExitStatus=2 3");
        expect(lines).toContain("Restart=on-failure");
        expect(lines).toContain("WantedBy=default.target");
        expect(lines.some((line) => line.startsWith("After="))).toBe(false);
        // t12：终端流的子进程要 herdr 的绝对路径；停止时只给面板 SIGTERM，等它先释放接管、改回尺寸。
        expect(lines).toContain("Environment=NBDEV_HERDR_BIN=/home/me/.local/bin/herdr");
        expect(lines).toContain("KillMode=mixed");
        expect(serviceUnit({mainRoot: "/home/me/neuro-book", bun: "/usr/bin/bun", port: 4400, artifactPort: 4401, herdrBin: null}).split("\n").some((line) => line.startsWith("Environment=NBDEV_HERDR_BIN"))).toBe(false);
        expect(lines[1]).toBe("# nbdev panel unit (installed by @notnotype/dev-panel)");
    });

    test("目录名里的空白与 % 按 systemd 的写法转义；单元名里换成 -", () => {
        const text = serviceUnit({mainRoot: "/home/me/my repo%1", bun: "/usr/bin/bun", port: 4400, artifactPort: 4401, herdrBin: null});
        expect(serviceUnitName("/home/me/my repo%1")).toBe("nbdev-panel-my-repo-1.service");
        expect(text).toContain('ExecStart=/usr/bin/bun "/home/me/my repo%%1/packages/dev-panel/src/cli.ts" panel serve');
        expect(text).toContain("WorkingDirectory=/home/me/my repo%%1");
    });
});

async function prepare(name: string): Promise<{fixture: Fixture; env: Record<string, string>; log: string; unitPath: string}> {
    const fixture = await createFixture(name);
    await fixture.write("packages/dev-panel/src/cli.ts", "// 桩：安装脚本只核对它存在\n");
    const bin = join(fixture.root, "fakebin");
    await mkdir(bin);
    const log = join(fixture.root, "systemctl.log");
    await writeFile(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> '${log}'\nexit \${FAKE_SYSTEMCTL_EXIT:-0}\n`);
    await chmod(join(bin, "systemctl"), 0o755);
    const configHome = join(fixture.root, "config");
    return {fixture, env: {PATH: `${bin}:${process.env.PATH ?? ""}`, XDG_CONFIG_HOME: configHome}, log, unitPath: join(configHome, "systemd", "user", "nbdev-panel-main.service")};
}

const calls = async (log: string) => (existsSync(log) ? (await readFile(log, "utf8")).trim().split("\n") : []);

describe("安装脚本", () => {
    test("--dry-run 什么都不写、不调 systemctl；安装写单元并 daemon-reload、enable --now；卸载 disable --now、删文件、daemon-reload", async () => {
        const {fixture, env, log, unitPath} = await prepare("service-install");
        const invoke = (args: string[], extra: Record<string, string> = {}) => run(process.execPath, [SCRIPT, "--target", fixture.main, "--json", ...args], fixture.main, undefined, 30_000, {...env, ...extra});

        const dry = await invoke(["--dry-run"]);
        expect([dry.exitCode, existsSync(unitPath), await calls(log)]).toEqual([0, false, []]);
        expect(JSON.parse(dry.stdout).data.content).toContain(`ExecStart=${process.execPath} ${fixture.main}/packages/dev-panel/src/cli.ts panel serve`);

        const installed = await invoke(["--port", "4410", "--artifact-port", "4411"]);
        expect(installed.exitCode).toBe(0);
        expect(await readFile(unitPath, "utf8")).toContain("--port 4410 --artifact-port 4411");
        expect(await calls(log)).toEqual(["--user daemon-reload", "--user enable --now nbdev-panel-main.service"]);

        const again = await invoke([]);
        expect(again.exitCode).toBe(0);

        const removed = await invoke(["--uninstall"]);
        expect([removed.exitCode, existsSync(unitPath)]).toEqual([0, false]);
        expect((await calls(log)).slice(-2)).toEqual(["--user disable --now nbdev-panel-main.service", "--user daemon-reload"]);
    }, 30_000);

    test("同名文件不是本脚本写的：不覆盖、不删，除非 --force；systemctl 失败报 systemctl_failed；主工作区里没有 nbdev 报 shim_target_not_found", async () => {
        const {fixture, env, log, unitPath} = await prepare("service-conflict");
        const invoke = (args: string[], extra: Record<string, string> = {}) => run(process.execPath, [SCRIPT, "--target", fixture.main, "--json", ...args], fixture.main, undefined, 30_000, {...env, ...extra});
        await mkdir(join(unitPath, ".."), {recursive: true});
        await writeFile(unitPath, "[Service]\nExecStart=/bin/true\n");
        for (const args of [[], ["--uninstall"]]) {
            const refused = await invoke(args);
            expect([refused.exitCode, JSON.parse(refused.stdout).errors[0]?.code]).toEqual([3, "service_exists"]);
        }
        expect([await readFile(unitPath, "utf8"), await calls(log)]).toEqual(["[Service]\nExecStart=/bin/true\n", []]);
        const failed = await invoke(["--force"], {FAKE_SYSTEMCTL_EXIT: "1"});
        expect([failed.exitCode, JSON.parse(failed.stdout).errors[0]?.code]).toEqual([1, "systemctl_failed"]);
        expect(await readFile(unitPath, "utf8")).toContain("# nbdev panel unit");

        const empty = await createFixture("service-no-cli");
        const missing = await run(process.execPath, [SCRIPT, "--target", empty.main, "--json", "--dry-run"], empty.main, undefined, 30_000, env);
        expect([missing.exitCode, JSON.parse(missing.stdout).errors[0]?.code]).toEqual([5, "shim_target_not_found"]);
    }, 30_000);
});
