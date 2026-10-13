import {isNbdevError, NbdevError, type ExitCode, type Warning} from "../core/errors.js";

export type Writable = {write(chunk: string): unknown};
/** 命令行的输入输出；`env` 是调用者的环境变量（认会话、找 herdr 都从这里取，核心函数不读 `process.env`）。 */
export type CliIo = {cwd: string; env: NodeJS.ProcessEnv; stdout: Writable; stderr: Writable};

/** 一条命令的结果：`error` 为空即成功（可以带警告）。 */
export type CommandOutcome = {
    schema: string;
    data: unknown;
    warnings: Warning[];
    error: NbdevError | null;
    /** 不加 `--json` 时打印到 stdout 的摘要。 */
    human: string[];
    /**
     * 长命令（`dev start`）已经边跑边按行输出了事件：成功时不再打一次性的外壳，退出码取 `exitCode`；警告照常写 stderr。
     * 起来之前就失败的仍按普通命令输出错误外壳。
     */
    streamed?: {exitCode: ExitCode};
};

export type ErrorEntry = {code: string; message: string; details?: Record<string, unknown>};

/** 把任意异常收成 nbdev 的错误条目；不是 NbdevError 的视为内部错误，并把堆栈写到 stderr 便于诊断。 */
export function toNbdevError(error: unknown, io: CliIo): NbdevError {
    if (isNbdevError(error)) return error;
    io.stderr.write(`nbdev 内部错误：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return new NbdevError("internal", error instanceof Error ? error.message : String(error), {cause: error});
}

function errorEntry(error: NbdevError): ErrorEntry {
    return error.details === undefined ? {code: error.code, message: error.message} : {code: error.code, message: error.message, details: error.details};
}

/**
 * 输出并返回退出码。`--json` 时 stdout 只有 `{schema, ok, data, warnings, errors}` 一个对象；
 * 否则 stdout 打印摘要，警告与错误走 stderr。
 */
export function emit(outcome: CommandOutcome, json: boolean, io: CliIo): ExitCode {
    if (outcome.streamed && !outcome.error) {
        for (const warning of outcome.warnings) io.stderr.write(json ? `${JSON.stringify({warning})}\n` : `警告 [${warning.code}] ${warning.message}\n`);
        return outcome.streamed.exitCode;
    }
    const errors = outcome.error ? [errorEntry(outcome.error)] : [];
    if (json) {
        io.stdout.write(`${JSON.stringify({schema: outcome.schema, ok: outcome.error === null, data: outcome.data ?? null, warnings: outcome.warnings, errors}, null, 2)}\n`);
    } else {
        for (const line of outcome.human) io.stdout.write(`${line}\n`);
        for (const warning of outcome.warnings) io.stderr.write(`警告 [${warning.code}] ${warning.message}\n`);
        if (outcome.error) io.stderr.write(`错误 [${outcome.error.code}] ${outcome.error.message}\n`);
    }
    return outcome.error ? outcome.error.exitCode : 0;
}
