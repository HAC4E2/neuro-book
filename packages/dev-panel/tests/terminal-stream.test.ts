import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFakeTerminals, fakeTerminalTools} from "./fake-terminal.js";
import {clampSize, parseStreamLine, resolveTerminalTools, startTerminalStream, streamArgs, type StreamLine, type TerminalStream, type TerminalTools} from "../src/server/terminal-stream.js";

/** t12 终端流（L1、L3）：参数白名单、逐行解析、假 herdr 命令行上的观看与接管、收口阶梯、暂停读。 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    await cleanupFakeTerminals();
});

function collect(tools: TerminalTools, kind: "observe" | "control", terminalId: string, size = {cols: 80, rows: 24}, takeover = false): {stream: TerminalStream; lines: StreamLine[]; bad: string[]} {
    const lines: StreamLine[] = [];
    const bad: string[] = [];
    const stream = startTerminalStream(tools, kind, terminalId, size, takeover, {onLine: (line) => lines.push(line), onBadLine: (line) => bad.push(line), onStderr: () => undefined});
    closers.push(() => stream.stop());
    return {stream, lines, bad};
}

async function until(check: () => boolean, ms = 5_000, what = "条件"): Promise<void> {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}`);
        await Bun.sleep(20);
    }
}

const alive = (pid: number) => existsSync(`/proc/${pid}`) && !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ");

describe("参数与解析（L1）", () => {
    test("只拼 observe 与 control 两种参数；target 不能以 - 开头；尺寸夹在范围里；setpriv 包在最外层", () => {
        const tools = {herdrBin: "/x/herdr", setprivBin: "/usr/bin/setpriv", setsidBin: "/usr/bin/setsid", socketPath: "/x/herdr.sock"};
        expect(streamArgs(tools, "control", "term_1a2b", {cols: 1000, rows: 2}, true)).toEqual(["/usr/bin/setpriv", "--pdeathsig", "TERM", "--", "/usr/bin/setsid", "/x/herdr", "terminal", "session", "control", "term_1a2b", "--takeover", "--cols", "400", "--rows", "5"]);
        expect(streamArgs(tools, "observe", "term_1", {cols: 80, rows: 24}, true)).not.toContain("--takeover");
        for (const bad of ["--takeover", "-x", "a b", "", "term;rm"]) expect(() => streamArgs(tools, "observe", bad, {cols: 80, rows: 24})).toThrow();
        expect(() => streamArgs(tools, "attach" as never, "term_1", {cols: 80, rows: 24})).toThrow();
        expect([clampSize(80.5, 24), clampSize("80", 24), clampSize(10, 300)]).toEqual([null, null, {cols: 20, rows: 200}]);
    });

    test("逐行解析：帧、结束、认不出的行", () => {
        expect(parseStreamLine('{"type":"terminal.frame","seq":3,"full":false,"width":80,"height":24,"encoding":"ansi","bytes":"eA=="}')).toEqual({type: "frame", seq: 3, full: false, width: 80, height: 24, bytes: "eA=="});
        expect(parseStreamLine('{"type":"terminal.closed","reason":"detached"}')).toEqual({type: "closed", reason: "detached"});
        for (const bad of ["", "not json", '{"type":"terminal.frame","seq":1}', '{"type":"other"}', "[1,2]", '{"type":"terminal.frame","seq":1,"width":1,"height":1,"bytes":"x","encoding":"utf8"}']) expect(parseStreamLine(bad)).toBeNull();
    });

    test("找不到 herdr 或 setpriv 时终端功能关掉，写明原因", () => {
        expect(resolveTerminalTools({}, null, () => "/usr/bin/x")).toMatchObject({available: false});
        expect(resolveTerminalTools({}, "/x.sock", () => null)).toMatchObject({available: false});
        const util = (name: string) => (name === "setpriv" ? "/usr/bin/setpriv" : name === "setsid" ? "/usr/bin/setsid" : null);
        expect(resolveTerminalTools({NBDEV_HERDR_BIN: "/nonexistent/herdr"}, "/x.sock", util)).toMatchObject({available: false});
        expect(resolveTerminalTools({NBDEV_HERDR_BIN: process.execPath}, "/x.sock", (name) => (name === "setpriv" ? "/usr/bin/setpriv" : null))).toMatchObject({available: false});
        expect(resolveTerminalTools({NBDEV_HERDR_BIN: process.execPath}, "/x.sock", util)).toMatchObject({available: true, tools: {herdrBin: process.execPath}});
    });
});

describe("假 herdr 命令行上的两条流（L3）", () => {
    test("observe：第一帧整屏，屏幕变了出增量；子进程的环境只有三个变量", async () => {
        const {tools, state} = await fakeTerminalTools("stream-observe", {term_a: {}});
        const {stream, lines} = collect(tools, "observe", "term_a");
        await until(() => lines.length >= 1, 5_000, "第一帧");
        expect(lines[0]).toMatchObject({type: "frame", seq: 1, full: true, width: 80, height: 24});
        await writeFile(join(state, "screen-term_a.txt"), "新的一行");
        await until(() => lines.length >= 2, 5_000, "增量帧");
        expect(lines[1]).toMatchObject({type: "frame", full: false});
        // setpriv 原地 exec 到假 herdr（经测试的 sh 包装再 exec 到 bun）：同一个 pid。sh 自己加的 PWD、SHLVL 与 bun 的变量不算面板给的。
        const envNames = (await readFile(`/proc/${stream.pid}/environ`, "utf8")).split("\0").filter(Boolean).map((entry) => entry.slice(0, entry.indexOf("="))).sort();
        expect(envNames.filter((name) => !name.startsWith("BUN_") && !["_", "PWD", "SHLVL", "OLDPWD"].includes(name))).toEqual(["HERDR_SOCKET_PATH", "HOME", "PATH"]);
        await stream.stop();
        expect(alive(stream.pid)).toBe(false);
    });

    test("control：输入、resize 写进 stdin；release 之后 closed 并退出；已有控制者时不带 takeover 第一行就是 closed", async () => {
        const {tools, state} = await fakeTerminalTools("stream-control", {term_c: {}});
        const first = collect(tools, "control", "term_c", {cols: 90, rows: 25});
        await until(() => first.lines.length >= 1, 5_000, "control 的第一帧");
        expect(JSON.parse(await readFile(join(state, "size-term_c.json"), "utf8"))).toEqual({cols: 90, rows: 25});
        first.stream.send({type: "input", text: "你好\r"});
        first.stream.send({type: "resize", cols: 100, rows: 30});
        await until(() => first.lines.length >= 3, 5_000, "输入与 resize 的帧");
        const second = collect(tools, "control", "term_c");
        await until(() => second.lines.length >= 1, 5_000, "第二个 control 的第一行");
        expect(second.lines[0]!.type).toBe("closed");
        await second.stream.exited;
        first.stream.send({type: "release"});
        await until(() => first.lines.some((line) => line.type === "closed"), 5_000, "release 之后的 closed");
        expect(await first.stream.exited).toBe(0);
        expect(first.stream.released).toBe(true);
        const inputs = (await readFile(join(state, "inputs-term_c.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {type: string});
        expect(inputs.map((input) => input.type)).toEqual(["terminal.input", "terminal.resize", "terminal.release"]);
    });

    test("收口阶梯：一行都不出的 control 也会在 2 秒多一点内被收掉；stop 之后子进程不在", async () => {
        const {tools} = await fakeTerminalTools("stream-silent", {term_s: {mode: "silent"}});
        const {stream} = collect(tools, "control", "term_s");
        await Bun.sleep(300);
        const started = Date.now();
        await stream.stop();
        expect(Date.now() - started).toBeLessThan(3_000);
        expect(alive(stream.pid)).toBe(false);
    });

    test("暂停读：子进程刷屏时停读，回调不再来；放开之后帧序号连续", async () => {
        const {tools} = await fakeTerminalTools("stream-flood", {term_f: {mode: "flood"}});
        const {stream, lines} = collect(tools, "observe", "term_f");
        await until(() => lines.length >= 5, 5_000, "刷屏");
        stream.pause();
        await Bun.sleep(300);
        const paused = lines.length;
        await Bun.sleep(500);
        // Bun 停读前已经读进来的那一批还会交完：之后不再增长。
        expect(lines.length - paused).toBeLessThan(200);
        const settled = lines.length;
        await Bun.sleep(300);
        expect(lines.length).toBe(settled);
        stream.resume();
        await until(() => lines.length > settled + 20, 5_000, "放开之后继续出帧");
        const seqs = lines.filter((line): line is Extract<StreamLine, {type: "frame"}> => line.type === "frame").map((line) => line.seq);
        expect(seqs.every((seq, index) => index === 0 || seq === seqs[index - 1]! + 1)).toBe(true);
    });
});
