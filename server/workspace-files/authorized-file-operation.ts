import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {
    assertRealPathContained,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    resolveFileAddress,
    type FileScope,
    type ResolvedFileAddress,
} from "nbook/server/workspace-files/file-scope";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";

/** Agent 文件操作的能力种类；所有数据面操作都需要同一份授权结果。 */
export type AuthorizedFileOperation = "read" | "write" | "edit" | "apply_patch";

/** 已完成领域解析、Project 生命周期和真实路径检查的文件操作目标。 */
export type AuthorizedFileTarget = Readonly<{
    operation: AuthorizedFileOperation;
    address: ResolvedFileAddress;
    /** 外部绝对路径没有File Scope containment；null表示直接受宿主文件系统权限约束。 */
    containmentRoot: AbsoluteFsPath | null;
}>;

/**
 * 授权一次文件操作。
 *
 * 调用方只提供 File Scope 和用户地址；本 Module 负责 Project open gate、规范化
 * File Address 以及受File Scope约束地址的真实路径 containment。外部绝对地址
 * 不套用当前File Scope边界，直接受宿主文件系统权限约束。写入不存在的受约束
 * 文件时，检查会落到最近已存在父目录，因此不会为了授权而隐式 mkdir。
 */
export async function authorizeFileOperation(
    scope: FileScope,
    inputPath: string,
    operation: AuthorizedFileOperation,
): Promise<AuthorizedFileTarget> {
    if (scope.kind === "managed-project") {
        assertProjectOpen(scope.currentProjectPath);
    }
    const address = resolveFileAddress(scope, inputPath);
    if (address.kind === "project-address") {
        assertProjectOpen(address.projectPath);
    }
    const containmentRoot = resolveContainmentRoot(scope, address);
    if (containmentRoot) {
        await assertRealPathContained(containmentRoot, address.absolutePath);
    }
    return {operation, address, containmentRoot};
}

/** 根据已经解析出的地址种类收窄 File Scope，避免用非空断言绕过领域约束。 */
function resolveContainmentRoot(scope: FileScope, address: ResolvedFileAddress): AbsoluteFsPath | null {
    if (address.kind === "absolute" && address.projectPath === null) {
        return null;
    }
    if (address.kind === "workspace-nbook-address") {
        if (scope.kind === "user-assets") {
            return scope.root;
        }
        if (scope.kind === "workspace" || scope.kind === "managed-project") {
            return resolveContainedFilePath(scope.workspaceRoot, ".nbook");
        }
        throw new Error("外部 File Scope不能解析Workspace Root .nbook File Address");
    }
    if (address.kind === "project-address") {
        if (scope.kind !== "workspace" && scope.kind !== "managed-project") {
            throw new Error("当前 File Scope不能解析managed Project File Address");
        }
        return resolveProjectWorkspaceRoot(scope.workspaceRoot, address.projectPath);
    }
    return scope.root;
}

/**
 * 授权受信任进程使用当前 File Scope 根作为 cwd。
 *
 * 本接口只验证 managed Project 已打开且 cwd 本身可信；它不限制命令随后可访问的
 * 文件。bash 是完整 Shell，明确不属于文件级 Authorized File Operation 承诺。
 */
export async function authorizeProcessCwd(
    scope: FileScope,
): Promise<Readonly<{root: AbsoluteFsPath}>> {
    if (scope.kind === "managed-project") {
        assertProjectOpen(scope.currentProjectPath);
    }
    await assertRealPathContained(scope.root, scope.root);
    return {root: scope.root};
}
