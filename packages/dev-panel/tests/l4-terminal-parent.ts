/**
 * L4 用（`herdr-live.test.ts` 的 t12 部分）：经面板同一个适配层起一个 observe、一个 control，两者都收到第一帧后打印 pid，
 * 然后一直等着。测试 SIGKILL 这个进程，核对两个子进程随之退出（`setpriv --pdeathsig`）、控制权随之释放。
 * 用法：bun l4-terminal-parent.ts <herdr socket> <terminal id>
 */
import {resolveTerminalTools, startTerminalStream, type StreamLine} from "../src/server/terminal-stream.js";

const [socketPath, terminalId] = process.argv.slice(2) as [string, string];
const resolved = resolveTerminalTools({PATH: process.env.PATH ?? ""}, socketPath, (name) => Bun.which(name));
if (!resolved.available) throw new Error(resolved.reason);
const tools = resolved.tools;

function start(kind: "observe" | "control"): Promise<number> {
    return new Promise((resolve, reject) => {
        let first = true;
        const stream = startTerminalStream(tools, kind, terminalId, {cols: 80, rows: 24}, false, {
            onLine: (line: StreamLine) => {
                if (!first) return;
                first = false;
                if (line.type === "frame") resolve(stream.pid);
                else reject(new Error(`${kind} 的第一行不是帧：${line.reason}`));
            },
            onBadLine: (line) => console.error(`${kind} 有一行读不懂：${line}`),
            onStderr: (text) => console.error(`${kind}：${text.trim()}`),
        });
    });
}

const [observe, control] = await Promise.all([start("observe"), start("control")]);
console.log(JSON.stringify({observe, control}));
setInterval(() => undefined, 60_000);
