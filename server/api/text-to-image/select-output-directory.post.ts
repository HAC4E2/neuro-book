import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

type SelectOutputDirectoryBody = {
    currentPath?: unknown;
};

type SelectOutputDirectoryResponse = {
    path: string | null;
};

/**
 * 打开本机目录选择对话框，用于配置 NovelAI 返回图片的保存目录。
 */
export default defineEventHandler(async (event): Promise<SelectOutputDirectoryResponse> => {
    if (process.platform !== "win32") {
        throw createError({statusCode: 501, message: "当前仅支持在 Windows 本机选择目录"});
    }

    const body = await readBody<SelectOutputDirectoryBody>(event).catch((): SelectOutputDirectoryBody => ({}));
    const initialDirectory = await resolveInitialDirectory(typeof body.currentPath === "string" ? body.currentPath : "");
    const powershellPath = resolveWindowsPowershellPath();
    const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$dialog.Description = '选择 NovelAI 返回图片保存目录'",
        "$dialog.ShowNewFolderButton = $true",
        "if ($env:NB_INITIAL_DIR -and [System.IO.Directory]::Exists($env:NB_INITIAL_DIR)) { $dialog.SelectedPath = $env:NB_INITIAL_DIR }",
        "$result = $dialog.ShowDialog()",
        "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }",
    ].join("; ");

    try {
        const {stdout} = await execFileAsync(powershellPath, [
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ], {
            env: {
                ...process.env,
                NB_INITIAL_DIR: initialDirectory,
            },
            windowsHide: true,
        });
        const selectedPath = stdout.trim();
        if (!selectedPath) {
            return {path: null};
        }
        const stat = await fs.stat(selectedPath);
        if (!stat.isDirectory()) {
            throw createError({statusCode: 400, message: "选择的路径不是目录"});
        }
        return {path: selectedPath};
    } catch (error) {
        if (isH3ErrorLike(error)) {
            throw error;
        }
        throw createError({
            statusCode: 500,
            message: `打开目录选择器失败：${error instanceof Error ? error.message : String(error)}`,
        });
    }
});

/**
 * 解析可用于目录选择器初始位置的已有目录。
 */
async function resolveInitialDirectory(input: string): Promise<string> {
    const trimmed = input.trim().replace(/^"|"$/gu, "");
    if (!trimmed || !path.isAbsolute(trimmed)) {
        return process.cwd();
    }

    let candidate = path.resolve(trimmed);
    for (;;) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isDirectory()) {
                return candidate;
            }
            return path.dirname(candidate);
        } catch {
            const parent = path.dirname(candidate);
            if (parent === candidate) {
                return process.cwd();
            }
            candidate = parent;
        }
    }
}

/**
 * 找到 Windows PowerShell 可执行文件。
 */
function resolveWindowsPowershellPath(): string {
    const systemRoot = process.env.SystemRoot;
    return systemRoot
        ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "powershell.exe";
}

/**
 * 避免吞掉已经由 h3 创建的错误。
 */
function isH3ErrorLike(error: unknown): boolean {
    return typeof error === "object" && error !== null && "statusCode" in error;
}
