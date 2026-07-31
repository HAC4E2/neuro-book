import {readdir, rm} from "node:fs/promises";
import {join, relative, resolve, sep} from "node:path";

import {withInstallLock} from "#manager/lock";
import {resolveInstallationRoots} from "#manager/root-locators";
import type {InstallationManifest, ResolvedInstallationRoots} from "#manager/types";

export type UninstallResult = {
    installationRoot: string;
    stateRoot: string;
    statePreserved: boolean;
};

/**
 * 删除受管安装拥有的程序、缓存和桌面本地状态。
 *
 * 默认保留 State Root，但会删除其中不属于内容备份的 logs。Portable 的 State Root
 * 位于 Installation Root 内，因此默认卸载会留下承载 data 的目录外壳。停止检查与
 * 所有权删除在同一个 install lock 内开始，调用方不能绕过运行状态门禁。
 */
export async function uninstallInstallation(options: {
    installationRoot: string;
    manifest: InstallationManifest;
    stop: () => Promise<void>;
    deleteData?: boolean;
    localDataRoot?: string;
}): Promise<UninstallResult> {
    const installationRoot = resolve(options.installationRoot);
    const roots = resolveInstallationRoots(installationRoot, options.manifest.roots, options.localDataRoot);
    const lockPath = join(installationRoot, ".deploy", "install.lock");
    await withInstallLock(lockPath, async () => {
        await options.stop();
        if (options.deleteData) {
            for (const target of topLevelRoots([roots.state, roots.cache, roots.desktop])) {
                await rm(target, {recursive: true, force: true});
            }
            await removeTreeExcept(installationRoot, [lockPath]);
            return;
        }

        await rm(roots.cache, {recursive: true, force: true});
        await rm(roots.desktop, {recursive: true, force: true});
        await rm(resolve(roots.state, "logs"), {recursive: true, force: true});

        await removeTreeExcept(installationRoot, isSameOrWithin(installationRoot, roots.state)
            ? [roots.state, lockPath]
            : [lockPath]);
    });

    // Windows 不能在 install.lock 句柄打开时删除其祖先；释放锁后只清理已失去
    // manifest/runtime 的目录外壳，新的 Manager 操作已无法把它识别为受管实例。
    if (options.deleteData || !isSameOrWithin(installationRoot, roots.state)) {
        await rm(installationRoot, {recursive: true, force: true});
    } else {
        await removeTreeExcept(installationRoot, [roots.state]);
    }
    return {installationRoot, stateRoot: roots.state, statePreserved: !options.deleteData};
}

/** 在 install lock 内停止实例并删除 Desktop Local Root；WebView Root 随之重置。 */
export async function resetDesktopLocalState(options: {
    installationRoot: string;
    manifest: InstallationManifest;
    stop: () => Promise<void>;
    localDataRoot?: string;
}): Promise<string> {
    const installationRoot = resolve(options.installationRoot);
    const roots = resolveInstallationRoots(installationRoot, options.manifest.roots, options.localDataRoot);
    await withInstallLock(join(installationRoot, ".deploy", "install.lock"), async () => {
        await options.stop();
        await rm(roots.desktop, {recursive: true, force: true});
    });
    return roots.desktop;
}

/** 删除目录树中除 preserve roots 及其祖先路径外的所有节点。 */
async function removeTreeExcept(currentRoot: string, preserveRoots: string[]): Promise<void> {
    if (preserveRoots.some((root) => samePath(currentRoot, root))) return;
    const entries = await readdir(currentRoot, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    for (const entry of entries) {
        const target = resolve(currentRoot, entry.name);
        if (preserveRoots.some((root) => samePath(target, root))) continue;
        const nestedRoots = preserveRoots.filter((root) => isSameOrWithin(target, root));
        if (nestedRoots.length > 0) {
            await removeTreeExcept(target, nestedRoots);
            continue;
        }
        await rm(target, {recursive: true, force: true});
    }
}

/** 去除被其他待删 root 包含的子 root，避免并发或重复删除产生所有权歧义。 */
function topLevelRoots(roots: string[]): string[] {
    const unique = [...new Set(roots.map((root) => resolve(root)))];
    return unique.filter((candidate) => !unique.some((other) => (
        !samePath(candidate, other) && isSameOrWithin(other, candidate)
    )));
}

function isSameOrWithin(root: string, target: string): boolean {
    const path = relative(resolve(root), resolve(target));
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

function samePath(left: string, right: string): boolean {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    return process.platform === "win32"
        ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
        : normalizedLeft === normalizedRight;
}
