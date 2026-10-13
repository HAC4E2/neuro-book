/**
 * 假的 `herdr terminal session observe|control`（t12 的 L3）：只认面板拼的那两种参数。状态目录是 `HERDR_SOCKET_PATH` 旁边的
 * `fake-cli/`（面板只给子进程三个环境变量，测试的设定只能从 socket 的位置推出来）：
 * - `config.json`：`{terminals: {<terminal id>: {mode?: "normal" | "silent" | "gone" | "flood", reasons?: "a" | "b"}}}`；
 * - `owner-<id>.json`：当前的控制者（pid），模拟“同一终端只有一个 control”与 `--takeover`；
 * - `size-<id>.json`：control 设的尺寸（模拟真实终端被改了尺寸）；
 * - `inputs-<id>.jsonl`：control 收到的每一行输入；`screen-<id>.txt`：测试改它，observe 就出一帧增量。
 * 写 stdout 用同步写：管道满了就阻塞，背压能传到这里（与 herdr 一样）。
 */
import {appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync, writeSync} from "node:fs";
import {dirname, join} from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "terminal" || args[1] !== "session" || (args[2] !== "observe" && args[2] !== "control")) {
    process.stderr.write(`fake herdr: 不认识的命令 ${args.join(" ")}\n`);
    process.exit(2);
}
const kind = args[2];
const target = args[3]!;
let takeover = false;
let cols = 120;
let rows = 40;
for (let index = 4; index < args.length; index += 1) {
    if (args[index] === "--takeover") takeover = true;
    else if (args[index] === "--cols") cols = Number(args[++index]);
    else if (args[index] === "--rows") rows = Number(args[++index]);
    else {
        process.stderr.write(`unknown terminal session ${kind} option: ${args[index]}\n`);
        process.exit(2);
    }
}
const state = join(dirname(process.env.HERDR_SOCKET_PATH ?? "/nonexistent/x.sock"), "fake-cli");
const config = existsSync(join(state, "config.json")) ? JSON.parse(readFileSync(join(state, "config.json"), "utf8")) as {terminals?: Record<string, {mode?: string; reasons?: string}>} : {};
const settings = config.terminals?.[target] ?? {mode: "gone"};
const reasons = settings.reasons === "b"
    ? {gone: `终端 ${target} 不见了`, busy: `已经有人控制 ${target}`, taken: "控制权被别人拿走", detached: "已分离"}
    : {gone: `terminal attach ended: terminal ${target} not found`, busy: `terminal attach failed: terminal ${target} already has an attached client; retry with --takeover`, taken: "terminal attach taken over", detached: "detached"};
let seq = 0;
const out = (value: unknown) => writeSync(1, `${JSON.stringify(value)}\n`);
const frame = (text: string, full: boolean) => out({type: "terminal.frame", seq: ++seq, full, width: cols, height: rows, encoding: "ansi", bytes: Buffer.from(full ? `\u001b[2J\u001b[1;1H${text}` : text).toString("base64")});
const closed = (reason: string) => {
    out({type: "terminal.closed", reason});
    process.exit(0);
};
const ownerFile = join(state, `owner-${target}.json`);
const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
};

if (settings.mode === "gone") closed(reasons.gone);
if (settings.mode === "silent") setInterval(() => undefined, 60_000);
else if (kind === "control") {
    if (existsSync(ownerFile)) {
        const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as {pid: number};
        if (alive(owner.pid) && owner.pid !== process.pid && !takeover) closed(reasons.busy);
    }
    writeFileSync(ownerFile, JSON.stringify({pid: process.pid}));
    writeFileSync(join(state, `size-${target}.json`), JSON.stringify({cols, rows}));
    frame(`fake ${target} ${cols}x${rows}`, true);
    setInterval(() => {
        const owner = existsSync(ownerFile) ? (JSON.parse(readFileSync(ownerFile, "utf8")) as {pid: number}).pid : null;
        if (owner !== process.pid) closed(reasons.taken);
    }, 30);
    let buffer = "";
    const leave = () => {
        if (existsSync(ownerFile) && (JSON.parse(readFileSync(ownerFile, "utf8")) as {pid: number}).pid === process.pid) rmSync(ownerFile, {force: true});
        closed(reasons.detached);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            appendFileSync(join(state, `inputs-${target}.jsonl`), `${line}\n`);
            const input = JSON.parse(line) as {type: string; text?: string; cols?: number; rows?: number};
            if (input.type === "terminal.input") frame(input.text ?? "", false);
            else if (input.type === "terminal.resize") {
                cols = input.cols!;
                rows = input.rows!;
                writeFileSync(join(state, `size-${target}.json`), JSON.stringify({cols, rows}));
                frame(`resized ${cols}x${rows}`, false);
            } else if (input.type === "terminal.release") leave();
            newline = buffer.indexOf("\n");
        }
    });
    process.stdin.on("end", leave);
} else {
    const screen = join(state, `screen-${target}.txt`);
    frame(existsSync(screen) ? readFileSync(screen, "utf8") : `fake ${target}`, true);
    if (settings.mode === "flood") {
        const chunk = "x".repeat(4096);
        for (;;) frame(chunk, false);
    }
    let last = existsSync(screen) ? statSync(screen).mtimeMs : 0;
    setInterval(() => {
        const now = existsSync(screen) ? statSync(screen).mtimeMs : 0;
        if (now !== last) {
            last = now;
            frame(readFileSync(screen, "utf8"), false);
        }
    }, 20);
}
process.on("SIGTERM", () => {
    if (kind === "control" && existsSync(ownerFile) && (JSON.parse(readFileSync(ownerFile, "utf8")) as {pid: number}).pid === process.pid) rmSync(ownerFile, {force: true});
    process.exit(0);
});
