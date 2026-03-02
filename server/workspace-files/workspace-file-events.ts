import path from "node:path";
import fs from "node:fs/promises";
import {watch, type FSWatcher} from "chokidar";
import type {
    WorkspaceFileChangeEventDto,
    WorkspaceFileEventKind,
    WorkspaceFileStreamEventDto,
} from "nbook/shared/dto/workspace-file-events.dto";
import {resolveWorkspaceRoot, toWorkspaceDisplayPath} from "nbook/server/workspace-files/workspace-files";

type WorkspaceFileEventHandler = (event: WorkspaceFileStreamEventDto) => void | Promise<void>;

type WorkspaceWatcherEntry = {
    root: string;
    rootInput: string;
    watcher: FSWatcher;
    subscribers: Set<WorkspaceFileEventHandler>;
    pendingEvents: Map<string, WorkspaceFileChangeEventDto>;
    sequence: number;
    flushTimer: ReturnType<typeof setTimeout> | null;
    ready: Promise<void>;
};

const WORKSPACE_EVENT_DEBOUNCE_MS = 120;
const watcherEntries = new Map<string, WorkspaceWatcherEntry>();

/**
 * 订阅指定 workspace 根目录下的文件系统变化。
 */
export async function subscribeWorkspaceFileEvents(
    rootInput: string | undefined,
    handler: WorkspaceFileEventHandler,
): Promise<() => void> {
    const entry = await ensureWorkspaceWatcher(rootInput);
    entry.subscribers.add(handler);
    await entry.ready;
    await handler({
        type: "workspace_watch_ready",
        root: entry.rootInput,
        sequence: entry.sequence,
        changedAt: new Date().toISOString(),
    });

    return () => {
        entry.subscribers.delete(handler);
        if (entry.subscribers.size > 0) {
            return;
        }
        watcherEntries.delete(entry.root);
        if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
        }
        void entry.watcher.close();
    };
}

/**
 * 确保指定 workspace 已有共享 watcher。
 */
async function ensureWorkspaceWatcher(rootInput: string | undefined): Promise<WorkspaceWatcherEntry> {
    const root = resolveWorkspaceRoot(rootInput);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error(`workspace root 不是目录: ${rootInput ?? "workspace"}`);
    }

    const existing = watcherEntries.get(root);
    if (existing) {
        return existing;
    }

    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    const entry: WorkspaceWatcherEntry = {
        root,
        rootInput: normalizeRootInput(rootInput),
        watcher: watch(root, {
            awaitWriteFinish: {
                stabilityThreshold: WORKSPACE_EVENT_DEBOUNCE_MS,
                pollInterval: 50,
            },
            cwd: root,
            ignoreInitial: true,
            ignored: isIgnoredWorkspaceWatchPath,
            persistent: true,
        }),
        subscribers: new Set(),
        pendingEvents: new Map(),
        sequence: 0,
        flushTimer: null,
        ready,
    };

    entry.watcher.on("all", (eventName, changedPath) => {
        recordWorkspaceFileEvent(entry, eventName, String(changedPath));
    });
    entry.watcher.on("ready", () => {
        resolveReady();
    });
    entry.watcher.on("error", (error) => {
        console.error("[workspace-files] watcher failed", {
            root: entry.rootInput,
        }, error);
    });

    watcherEntries.set(root, entry);
    return entry;
}

/**
 * 记录一次文件变化，并等待 debounce 窗口合并事件。
 */
function recordWorkspaceFileEvent(entry: WorkspaceWatcherEntry, eventName: string, changedPath: string): void {
    const kind = normalizeWorkspaceEventKind(eventName);
    if (!kind) {
        return;
    }

    const eventPath = normalizeWorkspaceEventPath(entry.root, changedPath);
    if (!eventPath || isIgnoredWorkspaceWatchPath(eventPath)) {
        return;
    }

    entry.pendingEvents.set(eventPath, {
        kind,
        path: eventPath,
    });

    if (entry.flushTimer) {
        clearTimeout(entry.flushTimer);
    }
    entry.flushTimer = setTimeout(() => {
        flushWorkspaceFileEvents(entry);
    }, WORKSPACE_EVENT_DEBOUNCE_MS);
}

/**
 * 推送合并后的文件变化批次。
 */
function flushWorkspaceFileEvents(entry: WorkspaceWatcherEntry): void {
    entry.flushTimer = null;
    const events = [...entry.pendingEvents.values()];
    entry.pendingEvents.clear();
    if (events.length === 0) {
        return;
    }

    entry.sequence += 1;
    const payload: WorkspaceFileStreamEventDto = {
        type: "workspace_files_changed",
        root: entry.rootInput,
        sequence: entry.sequence,
        changedAt: new Date().toISOString(),
        events,
    };

    for (const subscriber of entry.subscribers) {
        void subscriber(payload);
    }
}

/**
 * 将 chokidar 事件名收敛为前端 DTO。
 */
function normalizeWorkspaceEventKind(eventName: string): WorkspaceFileEventKind | null {
    if (
        eventName === "add"
        || eventName === "change"
        || eventName === "unlink"
        || eventName === "addDir"
        || eventName === "unlinkDir"
    ) {
        return eventName;
    }
    return null;
}

/**
 * 将 watcher 路径归一成 workspace 内的前端路径。
 */
function normalizeWorkspaceEventPath(root: string, changedPath: string): string {
    const absolutePath = path.isAbsolute(changedPath)
        ? changedPath
        : path.resolve(root, changedPath);
    return toWorkspaceDisplayPath(root, absolutePath).replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * 过滤不应该出现在 workspace 文件流里的内部目录。
 */
function isIgnoredWorkspaceWatchPath(value: string): boolean {
    return value.replace(/\\/g, "/").split("/").includes(".git");
}

/**
 * 保持事件 payload 中 root 的稳定展示形式。
 */
function normalizeRootInput(rootInput: string | undefined): string {
    return (rootInput?.trim() || "workspace").replace(/\\/g, "/").replace(/\/+$/, "");
}
