// 多轮修订谱系与台账 v3（Task 24 Phase 1）。
//
// 一次审稿 = 一轮，一轮 = 一个自包含目录 + 台账里的一个条目：
//
//     .agent/llmlint/
//         session.json              台账（跨轮累积的唯一沉淀）
//         rounds/0001/
//             source/<basename>     修前快照（步骤 2 跑 check 之前拷下来的）
//             check-source.json     步骤 2 的 check --format json
//             detect-source.json    步骤 2 的 detect --format json
//             plan.md               修复计划
//             output/<basename>     修后稿
//             check-output.json     复测 check
//             detect-output.json    复测 detect
//
// 为什么目录由代码建而不是让 Agent 拼：contribute 要读这些文件产出上传条目，
// 轮号算错或快照漏拷会产出「错但看不出来」的数据。轮号、目录、台账骨架全部在这里定，
// Agent 只负责往条目里填判断类字段（decisions / judgment / retest）。
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {loadUserSettings, type SharingTier} from "./user-state";

/** 台账 schema 版本。v2 不迁移不兼容——它从来没有代码读过，没有兼容负担。 */
export const LEDGER_VERSION = 3;

const LLMLINT_DIR = join(".agent", "llmlint");
const LEDGER_FILE = "session.json";
const ROUNDS_DIR = "rounds";

/** 一轮的检测指标。docPAi / spread 由 Agent 从 detect 报告抄一个数；命中分布不在这里，在轮目录的 check JSON 里。 */
export type RoundMetrics = {
    staticIssues: number;
    densityIssues: number;
    docPAi: number;
    spread: number;
};

/** 复测指标：比 summary 多一个判据结论。verdict 判据见 SKILL.md 步骤 4（命中减少 + 无新命中 + 篇幅 ±20%）。 */
export type RoundRetest = RoundMetrics & {
    verdict: "pass" | "fail";
};

/** 一处疑难判定。这是学习出口的原料，也是 fragments 档上传的主体。 */
export type RoundDecision = {
    file: string;
    line: number;
    /** null = 语义规则或无规则依托的观察（四象限「规则静默 × 文内高位」那一格）。 */
    ruleId: string | null;
    fragment: string;
    verdict: "fix" | "keep" | "ask";
    reason: string;
};

/**
 * 作者自评。全部字段可 null（拒答不阻塞流程）。
 *
 * `blind` 恒 false 且必须如实写：这是作者对自己刚改完的稿子打分，不是独立盲评，
 * 不能用来满足 D5 的第二条件（那条要求独立盲评，出口在 web 采集站）。
 */
export type RoundJudgment = {
    /** 修前分，问在步骤 1 跑 check 之前——读完「你这稿多少处 AI 味」再打分会被带偏。 */
    wantReadOnBefore: number | null;
    /** 修后分，问在复测通过之后。 */
    wantReadOnAfter: number | null;
    comment: string | null;
    blind: false;
};

export type RoundStatus = "running" | "completed" | "aborted";

export type RoundEntry = {
    round: number;
    /**
     * 父轮号：本轮续修的是哪一轮的 output。null = 另起一篇。
     *
     * 必须显式声明，不能靠「上轮 output 哈希 ≠ 本轮 source 哈希」推——作者第 1 轮审第 1 章、
     * 第 2 轮审第 2 章时两个哈希天然不等，那样推会凭空捏造一条不存在的用户修订边。
     */
    parentRound: number | null;
    startedAt: string;
    /** null = 本轮还没收尾。 */
    completedAt: string | null;
    status: RoundStatus;
    /** 原始输入路径（相对 cwd），与 source/ 里的 basename 对应。 */
    sourceFiles: string[];
    settings: {sharingTier: SharingTier; login: "none"};
    /** null = 步骤 2 还没写回。 */
    summary: RoundMetrics | null;
    /** null = 还没复测。 */
    retest: RoundRetest | null;
    decisions: RoundDecision[];
    localConfigSuggestions: string[];
    judgment: RoundJudgment;
    /** 非 null = 已导出到发件箱，不再重复导出。 */
    contributedAt: string | null;
};

export type Ledger = {
    version: typeof LEDGER_VERSION;
    /** 随机 UUID，无任何语义。服务端将来按它把同项目多轮分组，而不需要看到任何内容。 */
    projectId: string;
    rounds: RoundEntry[];
};

/** 台账与轮目录的根，按 cwd 解析（与 check 的相对路径行为一致，Agent 在项目根运行）。 */
export function llmlintDir(cwd: string): string {
    return join(resolve(cwd), LLMLINT_DIR);
}

export function ledgerPath(cwd: string): string {
    return join(llmlintDir(cwd), LEDGER_FILE);
}

export function roundsRoot(cwd: string): string {
    return join(llmlintDir(cwd), ROUNDS_DIR);
}

/** 轮目录路径。轮号四位零填充，1 → rounds/0001。 */
export function roundDir(cwd: string, round: number): string {
    return join(roundsRoot(cwd), formatRoundNumber(round));
}

export function formatRoundNumber(round: number): string {
    return String(round).padStart(4, "0");
}

/**
 * 读台账。文件不存在返回 null；版本不是 v3 直接抛——不写兼容分支，
 * 旧档由用户自行删除或另存（`decisions` 想留就手工搬过去）。
 */
export function loadLedger(cwd: string): Ledger | null {
    const filePath = ledgerPath(cwd);
    if (!existsSync(filePath)) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    } catch (error) {
        throw new Error(`${filePath} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${filePath} 顶层必须是对象。`);
    }
    const ledger = parsed as Partial<Ledger>;
    if (ledger.version !== LEDGER_VERSION) {
        throw new Error(
            `${filePath} 是 v${String(ledger.version)} 台账，当前版本 v${LEDGER_VERSION}，不做迁移。`
                + `需要保留旧记录请自行另存后删除该文件。`,
        );
    }
    if (typeof ledger.projectId !== "string" || ledger.projectId.length === 0) {
        throw new Error(`${filePath} 缺少 projectId。`);
    }
    if (!Array.isArray(ledger.rounds)) {
        throw new Error(`${filePath} 的 rounds 必须是数组。`);
    }
    return {version: LEDGER_VERSION, projectId: ledger.projectId, rounds: ledger.rounds};
}

/** 全量写台账，四空格 JSON + 尾换行（与 settings.json 同风格，diff 友好）。 */
export function saveLedger(cwd: string, ledger: Ledger): void {
    mkdirSync(llmlintDir(cwd), {recursive: true});
    writeFileSync(ledgerPath(cwd), `${JSON.stringify(ledger, null, 4)}\n`, "utf-8");
}

/**
 * 下一个轮号 = max(台账各 round, rounds/ 现有目录号) + 1。
 *
 * 目录也参与是为了让中断轮（建了目录没写完台账）占住号不被复用——
 * 复用会让两轮的产物混在同一个目录里，谱系直接失真。
 */
export function nextRoundNumber(cwd: string, ledger: Ledger | null): number {
    let max = 0;
    for (const entry of ledger?.rounds ?? []) {
        if (typeof entry.round === "number" && entry.round > max) {
            max = entry.round;
        }
    }
    const root = roundsRoot(cwd);
    if (existsSync(root)) {
        for (const name of readdirSync(root, {withFileTypes: true})) {
            if (!name.isDirectory()) {
                continue;
            }
            const parsed = Number.parseInt(name.name, 10);
            if (Number.isInteger(parsed) && parsed > max) {
                max = parsed;
            }
        }
    }
    return max + 1;
}

export type BeginRoundInput = {
    cwd: string;
    /** 本轮输入文件（相对或绝对路径均可）。 */
    files: string[];
    /** 续修哪一轮的 output；另起一篇传 null。 */
    parentRound: number | null;
    /** 注入时间戳，测试用；缺省取当前时间。 */
    now?: string;
};

export type BeginRoundResult = {
    round: number;
    dir: string;
    /** source/ 下的实际文件名，按 files 顺序对应（重名已消歧）。 */
    snapshots: string[];
};

/**
 * 起一轮：建目录 → 快照修前正文 → 追加台账骨架。
 *
 * 快照时机是步骤 2 跑 check 之前，此刻磁盘上的内容才是真正的「修前」。
 */
export function beginRound(input: BeginRoundInput): BeginRoundResult {
    if (input.files.length === 0) {
        throw new Error("round begin 至少需要一个输入文件。");
    }
    const cwd = resolve(input.cwd);
    const missing = input.files.filter((file) => !existsSync(resolve(cwd, file)));
    if (missing.length > 0) {
        throw new Error(`输入文件不存在：${missing.join("、")}`);
    }

    const ledger = loadLedger(cwd) ?? {version: LEDGER_VERSION, projectId: randomUUID(), rounds: []};
    if (input.parentRound !== null) {
        const parent = ledger.rounds.find((entry) => entry.round === input.parentRound);
        if (!parent) {
            throw new Error(`台账里没有第 ${input.parentRound} 轮，--parent 只能指向已有的轮。`);
        }
    }

    const round = nextRoundNumber(cwd, ledger);
    const dir = roundDir(cwd, round);
    const sourceDir = join(dir, "source");
    mkdirSync(sourceDir, {recursive: true});

    // basename 镜像；重名加数字前缀消歧（台账 sourceFiles 保留原始路径，不丢信息）。
    const used = new Set<string>();
    const snapshots: string[] = [];
    for (const file of input.files) {
        let name = basename(file);
        if (used.has(name)) {
            let seq = 2;
            while (used.has(`${seq}-${name}`)) {
                seq += 1;
            }
            name = `${seq}-${name}`;
        }
        used.add(name);
        copyFileSync(resolve(cwd, file), join(sourceDir, name));
        snapshots.push(name);
    }

    const startedAt = input.now ?? new Date().toISOString();
    ledger.rounds.push({
        round,
        parentRound: input.parentRound,
        startedAt,
        completedAt: null,
        status: "running",
        sourceFiles: [...input.files],
        settings: {sharingTier: loadUserSettings().sharing.tier, login: "none"},
        summary: null,
        retest: null,
        decisions: [],
        localConfigSuggestions: [],
        judgment: {wantReadOnBefore: null, wantReadOnAfter: null, comment: null, blind: false},
        contributedAt: null,
    });
    saveLedger(cwd, ledger);

    return {round, dir, snapshots};
}
