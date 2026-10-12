import {randomBytes} from "node:crypto";
import {chmod, mkdir, open, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {NbdevError, systemErrorCode} from "../core/errors.js";
import {processAlive, processStartTicks} from "../core/procfs.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";

/**
 * 面板进程的运行时文件，都在主工作区的 `.local/agent/` 下：
 * - `panel.json`：在跑的面板（地址、启动令牌），权限 600，`panel open` 读它；
 * - `run/panel.lock`：同一个主工作区同一时刻只跑一个面板（第二个会与第一个抢构建目录、互删 `panel.json`）。
 * 两份都按 pid 加启动时刻认进程，防 pid 复用。
 */

export const PANEL_FILE = `${AGENT_LOCAL_ROOT}/panel.json`;
export const PANEL_LOCK = `${AGENT_LOCAL_ROOT}/run/panel.lock`;
export const PANEL_SCHEMA = "nbdev.panel/v1";

export type PanelInfo = {
    schema: typeof PANEL_SCHEMA;
    pid: number;
    startTicks: string;
    startedAt: string;
    instanceId: string;
    url: string;
    artifactUrl: string;
    /** 启动令牌：`panel open` 用它签一次性登录票据。只在这份权限 600 的文件里，不进日志、不进页面。 */
    token: string;
};

type LockOwner = {pid: number; startTicks: string; startedAt: string};

async function ownProcess(): Promise<{pid: number; startTicks: string}> {
    const startTicks = await processStartTicks(process.pid);
    if (startTicks === null) throw new NbdevError("internal", "读不到本进程的启动时刻（/proc）");
    return {pid: process.pid, startTicks};
}

async function readJson(path: string): Promise<unknown | null> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        // 写到一半的文件或手改坏的：当作没有，由调用方按“不在跑”处理。
        process.emitWarning(`面板的运行时文件不是合法 JSON，按不存在处理：${path}（${error instanceof Error ? error.message : String(error)}）`);
        return null;
    }
}

function isOwner(value: unknown): value is LockOwner {
    return typeof value === "object" && value !== null && typeof (value as LockOwner).pid === "number" && typeof (value as LockOwner).startTicks === "string";
}

/** 面板锁：独占创建锁文件；已有的锁属于还在跑的进程时报 `panel_running`，属于已退出的进程时接管。 */
export async function acquirePanelLock(mainRoot: string): Promise<{release(): Promise<void>}> {
    const path = resolve(mainRoot, PANEL_LOCK);
    await mkdir(dirname(path), {recursive: true});
    const self = await ownProcess();
    const content = `${JSON.stringify({...self, startedAt: new Date().toISOString()})}\n`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const handle = await open(path, "wx", 0o600);
            await handle.writeFile(content);
            await handle.close();
            return {release: () => releaseIfOwn(path, self)};
        } catch (error) {
            if (systemErrorCode(error) !== "EEXIST") throw error;
        }
        const owner = await readJson(path);
        if (isOwner(owner) && await processAlive(owner)) {
            throw new NbdevError("panel_running", `这个主工作区已经有面板在跑（pid ${owner.pid}）；用 nbdev panel open 打开它`, {details: {pid: owner.pid, startedAt: (owner as LockOwner).startedAt ?? null}});
        }
        // 持锁者已退出：换成自己的锁（先写临时文件再改名，改名是原子的，两个接管者只有后一个的内容留下，下一轮再核对）。
        const temporary = `${path}.${randomBytes(4).toString("hex")}`;
        await writeFile(temporary, content, {mode: 0o600});
        await rename(temporary, path);
        const now = await readJson(path);
        if (isOwner(now) && now.pid === self.pid && now.startTicks === self.startTicks) return {release: () => releaseIfOwn(path, self)};
    }
    throw new NbdevError("panel_running", "抢面板锁连续失败，可能有别的面板正在启动", {details: {path: PANEL_LOCK}});
}

async function releaseIfOwn(path: string, self: {pid: number; startTicks: string}): Promise<void> {
    const owner = await readJson(path);
    if (isOwner(owner) && owner.pid === self.pid && owner.startTicks === self.startTicks) await rm(path, {force: true});
}

/** 原子写入 `panel.json`（权限 600）。 */
export async function writePanelInfo(mainRoot: string, info: Omit<PanelInfo, "schema" | "pid" | "startTicks" | "startedAt">): Promise<PanelInfo> {
    const path = resolve(mainRoot, PANEL_FILE);
    const self = await ownProcess();
    const record: PanelInfo = {schema: PANEL_SCHEMA, ...self, startedAt: new Date().toISOString(), ...info};
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 4)}\n`, {mode: 0o600});
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    return record;
}

/** 退出时只删 pid 与启动时刻都是自己的那份：别的实例（例如端口不同、锁被接管后起来的）写的不动。 */
export async function removePanelInfo(mainRoot: string): Promise<void> {
    const path = resolve(mainRoot, PANEL_FILE);
    const info = await readJson(path);
    const self = await ownProcess();
    if (isOwner(info) && info.pid === self.pid && info.startTicks === self.startTicks) await rm(path, {force: true});
}

/** 读 `panel.json`，并确认写它的进程还在；不在跑时返回 null。 */
export async function readRunningPanel(mainRoot: string): Promise<PanelInfo | null> {
    const info = await readJson(resolve(mainRoot, PANEL_FILE));
    if (!isOwner(info) || (info as PanelInfo).schema !== PANEL_SCHEMA) return null;
    const panel = info as PanelInfo;
    if (typeof panel.url !== "string" || typeof panel.token !== "string") return null;
    return await processAlive(panel) ? panel : null;
}
