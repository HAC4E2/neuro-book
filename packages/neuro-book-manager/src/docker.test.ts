import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parse} from "yaml";

import {
    buildSourceDockerImage,
    inspectDockerApplication,
    resolveContainerEngine,
    runDockerApplicationCommand,
    startDocker,
    stopDocker,
    stopDockerContainer,
    writeDockerCompose,
} from "#manager/docker";

const processCommands = vi.hoisted(() => ({
    available: vi.fn(),
    capture: vi.fn(),
    run: vi.fn(),
}));

vi.mock("#manager/process", () => ({
    commandAvailable: processCommands.available,
    runCapture: processCommands.capture,
    run: processCommands.run,
}));

const roots: string[] = [];
beforeEach(() => {
    vi.clearAllMocks();
    processCommands.available.mockResolvedValue(true);
});
afterEach(async () => {
    delete process.env.NEURO_BOOK_CONTAINER_ENGINE;
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Docker Compose部署合同", () => {
    it("Docker验证失败时选择完整可用的Podman", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "compose") throw new Error("compose missing");
            return "ok\n";
        });
        await expect(resolveContainerEngine()).resolves.toBe("podman");
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["compose", "version"], {
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
        expect(processCommands.capture).toHaveBeenCalledWith("podman", ["info"]);
    });

    it("显式engine在info失败时不静默切换", async () => {
        processCommands.capture.mockImplementation(async (command: string, args: string[]) => {
            if (command === "docker" && args[0] === "info") throw new Error("daemon unavailable");
            return "ok\n";
        });
        await expect(resolveContainerEngine("docker")).rejects.toThrow("daemon或machine不可用");
        expect(processCommands.available).not.toHaveBeenCalledWith("podman");
    });

    it("环境变量只接受docker或podman", async () => {
        process.env.NEURO_BOOK_CONTAINER_ENGINE = "nerdctl";
        await expect(resolveContainerEngine()).rejects.toThrow("只接受docker或podman");
        expect(processCommands.available).not.toHaveBeenCalled();
    });

    it("POSIX容器使用当前用户写入State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "docker", root, stateRoot: root, cacheRoot: join(root, ".cache"), profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string; volumes: string[]; environment: Record<string, string>}}};
        if (process.platform === "win32") expect(compose.services.app.user).toBeUndefined();
        else expect(compose.services.app.user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
        expect(compose.services.app.volumes).toContain("../.env:/app/.env");
        expect(compose.services.app.volumes).toContain("../tool-state:/app/tool-state");
        expect(compose.services.app.volumes).toContain("../.cache:/app/cache");
        expect(compose.services.app.environment).toMatchObject({
            NEURO_BOOK_CACHE_ROOT: "/app/cache",
            LLMLINT_HOME: "/app/tool-state/llmlint",
            LLMLINT_CACHE_DIR: "/app/cache/llmlint",
            BUN_INSTALL_CACHE_DIR: "/app/cache/bun/install",
        });
    });

    it("rootless Podman不重复注入宿主UID", async () => {
        processCommands.capture.mockResolvedValue("true\n");
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-podman-"));
        roots.push(root);
        const output = await writeDockerCompose({engine: "podman", root, stateRoot: root, cacheRoot: join(root, ".cache"), profile: "source-docker", image: "neuro-book:test", port: 3000});
        const compose = parse(await readFile(output, "utf8")) as {services: {app: {user?: string}}};
        expect(compose.services.app.user).toBeUndefined();
    });

    it("一次性应用命令覆盖Product ENTRYPOINT并保留参数边界", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";

        await expect(runDockerApplicationCommand("docker", root, stateRoot, [
            "bun",
            ".output/server/scripts/db/migrate-application-state.ts",
            "--plan",
            "--run-id",
            "operation-state",
        ])).resolves.toBe("migration-report");

        expect(processCommands.capture).toHaveBeenCalledWith("docker", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            ".output/server/scripts/db/migrate-application-state.ts",
            "--plan",
            "--run-id",
            "operation-state",
        ], {cwd: root});
    });

    it("Podman Compose固定使用podman-compose provider", async () => {
        processCommands.capture.mockResolvedValue("migration-report");
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";

        await runDockerApplicationCommand("podman", root, stateRoot, ["bun", "migration.ts"]);

        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "bun",
            "app",
            "migration.ts",
        ], {
            cwd: root,
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
    });

    it("Podman停止app时保留容器供doctor与恢复使用", async () => {
        const root = "/tmp/neuro-book";
        const stateRoot = "/tmp/neuro-book-state";
        const containerId = "a".repeat(64);
        processCommands.capture.mockResolvedValue(containerId);

        await stopDocker("podman", root, stateRoot);

        expect(processCommands.capture).toHaveBeenCalledWith("podman", [
            "compose",
            "--env-file",
            join(stateRoot, ".env"),
            "-f",
            join(root, ".deploy", "docker-compose.generated.yml"),
            "ps",
            "--quiet",
        ], {
            cwd: root,
            env: expect.objectContaining({PODMAN_COMPOSE_PROVIDER: "podman-compose"}),
        });
        expect(processCommands.run).toHaveBeenCalledWith("podman", [
            "stop",
            "--time",
            "10",
            containerId,
        ], {cwd: root});
        expect(processCommands.run).not.toHaveBeenCalledWith("podman", expect.arrayContaining(["compose", "stop"]), expect.anything());
    });

    it("Podman停止app时拒绝多容器或非ID输出", async () => {
        processCommands.capture.mockResolvedValue("container-one\ncontainer-two\n");

        await expect(stopDocker("podman", "/tmp/neuro-book", "/tmp/neuro-book-state"))
            .rejects.toThrow("非法app容器ID");
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it("Podman状态探测不读取Docker专属Health字段", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-inspect-podman-"));
        roots.push(root);
        const containerId = "b".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) return `${containerId}\n`;
            const format = args[2];
            if (format === "{{.Config.Image}}") return "ghcr.io/notnotype/neuro-book:test\n";
            if (format === "{{.State.Status}}") return "running\n";
            if (format === "{{.State.ExitCode}}") return "0\n";
            if (format?.includes("Health")) throw new Error("Podman无State.Health");
            throw new Error(`未预期命令：${args.join(" ")}`);
        });

        await expect(inspectDockerApplication("podman", root, root))
            .resolves.toEqual({
                configuredImage: "ghcr.io/notnotype/neuro-book:test",
                containerId,
                actualImage: "ghcr.io/notnotype/neuro-book:test",
                status: "running",
                exitCode: 0,
            });
        expect(processCommands.capture.mock.calls.some(([, args]) => args.includes("{{if .State.Health}}{{.State.Health.Status}}{{end}}")))
            .toBe(false);
        expect(processCommands.capture.mock.calls.some(([, args]) => args.includes("config")))
            .toBe(false);
        expect(processCommands.capture.mock.calls.some(([, args]) => args.includes("--all") || args.includes("app")))
            .toBe(false);
    });

    it("一次性应用命令拒绝空命令", async () => {
        await expect(runDockerApplicationCommand("docker", "/tmp/neuro-book", "/tmp/neuro-book-state", []))
            .rejects.toThrow("Docker一次性应用命令不能为空");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });

    it("Source Docker把staged HEAD作为Product Runtime Image revision", async () => {
        const sourceRoot = join(tmpdir(), "nbook-source-docker");
        const revision = "a".repeat(40);
        processCommands.capture.mockResolvedValue(`${revision}\n`);

        await buildSourceDockerImage("docker", sourceRoot, "neuro-book-source:test");

        expect(processCommands.capture).toHaveBeenCalledWith("git", ["rev-parse", "--verify", "HEAD"], {cwd: sourceRoot});
        expect(processCommands.run).toHaveBeenCalledWith("docker", [
            "build",
            "--file",
            join(sourceRoot, "Dockerfile"),
            "--build-arg",
            `NEURO_BOOK_SOURCE_REVISION=${revision}`,
            "--tag",
            "neuro-book-source:test",
            sourceRoot,
        ], {cwd: sourceRoot});
    });

    it("Source Docker拒绝无法证明的staged revision", async () => {
        processCommands.capture.mockResolvedValue("not-a-revision\n");

        await expect(buildSourceDockerImage("podman", "/tmp/neuro-book", "neuro-book-source:test"))
            .rejects.toThrow("无法读取有效revision");
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it("已有running容器只验证版本，不发布候选也不执行Compose up", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-compose-owned-launch-"));
        roots.push(root);
        const containerId = "c".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) return `${containerId}\n`;
            const format = args[2];
            if (format === "{{.Config.Image}}") return "ghcr.io/notnotype/neuro-book:test\n";
            if (format === "{{.State.Status}}") return "running\n";
            if (format === "{{.State.ExitCode}}") return "0\n";
            if (format?.includes("Health")) return "healthy\n";
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({versionLabel: "v0.9.0"}),
        } as Response);
        const started: string[] = [];
        const starting = vi.fn();
        try {
            await startDocker("docker", root, root, "ghcr", "0.9.0", starting, async (id) => {
                started.push(id);
            });
        } finally {
            fetchMock.mockRestore();
        }

        expect(starting).not.toHaveBeenCalled();
        expect(started).toEqual([]);
        expect(processCommands.run).not.toHaveBeenCalled();
    });

    it.each(["stopped", "missing"] as const)("%s容器启动后发布精确候选ID", async (previousState) => {
        const root = await mkdtemp(join(tmpdir(), `nbook-compose-${previousState}-launch-`));
        roots.push(root);
        const containerId = "d".repeat(64);
        await writeDockerCompose({
            engine: "docker",
            root,
            stateRoot: root,
            cacheRoot: join(root, ".cache"),
            profile: "ghcr",
            image: "ghcr.io/notnotype/neuro-book:test",
            port: 3000,
        });
        let psCalls = 0;
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("ps")) {
                psCalls += 1;
                return previousState === "missing" && psCalls === 1 ? "" : `${containerId}\n`;
            }
            const format = args[2];
            if (format === "{{.Config.Image}}") return "ghcr.io/notnotype/neuro-book:test\n";
            if (format === "{{.State.Status}}") return "exited\n";
            if (format === "{{.State.ExitCode}}") return "0\n";
            if (format?.includes("Health")) return "\n";
            throw new Error(`未预期命令：${args.join(" ")}`);
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({versionLabel: "v0.9.0"}));
        const checkpoints: string[] = [];
        try {
            await startDocker(
                "docker",
                root,
                root,
                "ghcr",
                "0.9.0",
                async () => { checkpoints.push("starting"); },
                async (id) => { checkpoints.push(`started:${id}`); },
            );
        } finally {
            fetchMock.mockRestore();
        }

        expect(checkpoints).toEqual(["starting", `started:${containerId}`]);
        expect(processCommands.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["pull", "app"]), {cwd: root});
        expect(processCommands.run).toHaveBeenCalledWith("docker", expect.arrayContaining(["up", "-d"]), {cwd: root});
    });
});
