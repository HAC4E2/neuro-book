import {accessSync, constants} from "node:fs";
import {isAbsolute} from "node:path";

/**
 * herdr 的两条终端流（t12）：`herdr terminal session observe|control <terminal id> …`，每个浏览器连接一个子进程。协议与实测见
 * docs/herdr.md 的“终端流”。这里只拼这两种参数（`HERDR_PANEL_STREAMS`），target 只收 herdr 列出来的 terminal id 的形状，
 * 尺寸只收范围内的整数：流不经 JSON 接口，客户端的方法白名单管不到命令行发给 server 的内容。
 * 子进程一律经 `setpriv --pdeathsig TERM -- setsid` 起：observe 不读 stdin、读端没了也不退出，面板异常退出时只有父进程死亡信号能收掉它；
 * 自成会话，面板前台运行时终端的 Ctrl+C 只打到面板，由面板按顺序收口。
 */

export const HERDR_PANEL_STREAMS = ["observe", "control"] as const;
export type StreamKind = (typeof HERDR_PANEL_STREAMS)[number];

export type StreamFrame = {type: "frame"; seq: number; full: boolean; width: number; height: number; bytes: string};
export type StreamClosed = {type: "closed"; reason: string};
export type StreamLine = StreamFrame | StreamClosed;
export type StreamInput = {type: "input"; text: string} | {type: "resize"; cols: number; rows: number} | {type: "release"};

export type TerminalTools = {herdrBin: string; setprivBin: string; setsidBin: string; socketPath: string};
export type ToolsStatus = {available: true; tools: TerminalTools} | {available: false; reason: string};

export const SIZE_LIMITS = {minCols: 20, maxCols: 400, minRows: 5, maxRows: 200} as const;
const TERMINAL_ID = /^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,127}$/u;

function executable(path: string): boolean {
    try {
        accessSync(path, constants.X_OK);
        return true;
    } catch (error) {
        if (error instanceof Error) return false;
        throw error;
    }
}

/**
 * 找 herdr 与 setpriv。`NBDEV_HERDR_BIN` 优先（systemd 用户服务的 `PATH` 不保证有 `~/.local/bin`，`install-service` 会写上它）。
 * 找不到时终端功能关掉并写明原因。
 */
export function resolveTerminalTools(env: NodeJS.ProcessEnv, socketPath: string | null, which: (name: string) => string | null): ToolsStatus {
    if (!socketPath) return {available: false, reason: "面板没有连 herdr"};
    const herdrBin = env.NBDEV_HERDR_BIN && isAbsolute(env.NBDEV_HERDR_BIN) ? env.NBDEV_HERDR_BIN : which("herdr");
    if (!herdrBin || !executable(herdrBin)) return {available: false, reason: "找不到 herdr 命令（设 NBDEV_HERDR_BIN 为它的绝对路径）"};
    const setprivBin = which("setpriv");
    const setsidBin = which("setsid");
    if (!setprivBin || !executable(setprivBin) || !setsidBin || !executable(setsidBin)) return {available: false, reason: "找不到 setpriv 或 setsid（util-linux）：没有它们，面板退出时收不掉终端流的子进程、来不及释放接管"};
    return {available: true, tools: {herdrBin, setprivBin, setsidBin, socketPath}};
}

/** 尺寸夹到范围里；不是整数就不收。 */
export function clampSize(cols: unknown, rows: unknown): {cols: number; rows: number} | null {
    if (typeof cols !== "number" || typeof rows !== "number" || !Number.isInteger(cols) || !Number.isInteger(rows)) return null;
    return {
        cols: Math.min(SIZE_LIMITS.maxCols, Math.max(SIZE_LIMITS.minCols, cols)),
        rows: Math.min(SIZE_LIMITS.maxRows, Math.max(SIZE_LIMITS.minRows, rows)),
    };
}

/** 一行输出；认不出的行回 null（调用方记日志、丢掉）。 */
export function parseStreamLine(line: string): StreamLine | null {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
    if (typeof value !== "object" || value === null) return null;
    const entry = value as Record<string, unknown>;
    if (entry.type === "terminal.frame") {
        if (typeof entry.seq !== "number" || typeof entry.width !== "number" || typeof entry.height !== "number" || typeof entry.bytes !== "string" || entry.encoding !== "ansi") return null;
        return {type: "frame", seq: entry.seq, full: entry.full === true, width: entry.width, height: entry.height, bytes: entry.bytes};
    }
    if (entry.type === "terminal.closed") return {type: "closed", reason: typeof entry.reason === "string" ? entry.reason : ""};
    return null;
}

export function encodeStreamInput(input: StreamInput): string {
    if (input.type === "input") return `${JSON.stringify({type: "terminal.input", text: input.text})}\n`;
    if (input.type === "resize") return `${JSON.stringify({type: "terminal.resize", cols: input.cols, rows: input.rows})}\n`;
    return `${JSON.stringify({type: "terminal.release"})}\n`;
}

export function streamArgs(tools: TerminalTools, kind: StreamKind, terminalId: string, size: {cols: number; rows: number}, takeover = false): string[] {
    if (!HERDR_PANEL_STREAMS.includes(kind)) throw new Error(`不是面板的终端流：${kind}`);
    // 第一个位置参数一律被当成 target（审查实测），而 target 不能以 `-` 开头，就拼不出额外的选项。
    if (!TERMINAL_ID.test(terminalId)) throw new Error(`terminal id 的写法不对：${terminalId}`);
    const clamped = clampSize(size.cols, size.rows);
    if (!clamped) throw new Error("尺寸不是整数");
    // setsid：子进程自成一个会话，前台运行时终端里的 Ctrl+C 不会同时打到它，面板来得及先改回尺寸、再 release。
    // pdeathsig 跨 exec 保留：面板异常退出时子进程照样被收掉。
    return [
        tools.setprivBin, "--pdeathsig", "TERM", "--", tools.setsidBin,
        tools.herdrBin, "terminal", "session", kind, terminalId,
        ...(kind === "control" && takeover ? ["--takeover"] : []),
        "--cols", String(clamped.cols), "--rows", String(clamped.rows),
    ];
}

export type TerminalStream = {
    readonly kind: StreamKind;
    readonly pid: number;
    /** 写一行输入；子进程已经退出时返回 false。 */
    send(input: StreamInput): boolean;
    /** 背压：暂停读 stdout（Bun 还会先攒几百 KB 才把背压传给子进程）；herdr 读端跟不上时自己合并帧。 */
    pause(): void;
    resume(): void;
    /** 我们发过 `terminal.release` 吗（结束原因的归类用）。 */
    readonly released: boolean;
    /** 收口：control 先 release、关 stdin；1 秒不退 SIGTERM，再 1 秒 SIGKILL；等到子进程退出。 */
    stop(): Promise<void>;
    readonly exited: Promise<number | null>;
};

export type StreamHandlers = {onLine: (line: StreamLine) => void; onBadLine: (line: string) => void; onStderr: (text: string) => void};

export function startTerminalStream(tools: TerminalTools, kind: StreamKind, terminalId: string, size: {cols: number; rows: number}, takeover: boolean, handlers: StreamHandlers): TerminalStream {
    const child = Bun.spawn(streamArgs(tools, kind, terminalId, size, takeover), {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", HERDR_SOCKET_PATH: tools.socketPath},
    });
    let paused = false;
    let wake: (() => void) | null = null;
    let released = false;
    let stdinOpen = true;
    const exited = child.exited.then((code) => code ?? null, () => null);
    void exited.then(() => {
        stdinOpen = false;
    });
    void (async () => {
        const reader = child.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            while (paused) await new Promise<void>((resolve) => (wake = resolve));
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const raw = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const line = parseStreamLine(raw);
                if (line) handlers.onLine(line);
                else if (raw.trim() !== "") handlers.onBadLine(raw.slice(0, 200));
                newline = buffer.indexOf("\n");
            }
        }
    })();
    void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of child.stderr) handlers.onStderr(decoder.decode(chunk).slice(0, 500));
    })();
    // 子进程已经死了、`exited` 还没兑现时写会抛 EPIPE：当作写不进去（调用方按“没有改回尺寸”“没有发出”处理）。
    const write = (text: string): boolean => {
        if (!stdinOpen) return false;
        try {
            child.stdin.write(text);
            child.stdin.flush();
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
            stdinOpen = false;
            return false;
        }
    };
    const resume = () => {
        paused = false;
        const resolve = wake;
        wake = null;
        resolve?.();
    };
    let stopping: Promise<void> | null = null;
    return {
        kind,
        pid: child.pid,
        get released() {
            return released;
        },
        send(input) {
            if (input.type === "release") released = true;
            return write(encodeStreamInput(input));
        },
        pause() {
            paused = true;
        },
        resume,
        stop() {
            stopping ??= (async () => {
                if (kind === "control" && stdinOpen) {
                    released = true;
                    write(encodeStreamInput({type: "release"}));
                }
                if (stdinOpen) {
                    stdinOpen = false;
                    try {
                        await Promise.resolve(child.stdin.end());
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
                    }
                }
                // 停读的流不读完就不会退出：收口时放开。
                resume();
                const timeout = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));
                if (kind === "observe") child.kill("SIGTERM");
                if (await Promise.race([exited, timeout(1_000)]) === "timeout") {
                    child.kill("SIGTERM");
                    if (await Promise.race([exited, timeout(1_000)]) === "timeout") child.kill("SIGKILL");
                }
                await exited;
            })();
            return stopping;
        },
        exited,
    };
}
