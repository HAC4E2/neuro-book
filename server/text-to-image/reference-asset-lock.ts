import {AsyncLocalStorage} from "node:async_hooks";
import {mkdir, open} from "node:fs/promises";
import path from "node:path";
import {lock} from "proper-lockfile";
import {
    absoluteFsPath,
    assertRealPathContained,
    resolveContainedFilePath,
} from "nbook/server/runtime/paths/file-path";
import {TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT} from "nbook/server/text-to-image/asset-path";
import {resolveWorkspaceRootInput, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import type {TextToImageReferencePromotionService} from "nbook/server/text-to-image/reference-promotion.service";

declare const referenceMutationScopeBrand: unique symbol;

/** 只有项目级引用资产锁回调能取得的不透明 mutation capability。 */
export type TextToImageReferenceMutationScope = Readonly<{
    [referenceMutationScopeBrand]: true;
    /**
     * P5 promotion port：只有锁回调能取得；两个方法都不会重新获取/释放锁，
     * P6 可在一个锁内跨 prepare/selection/promotion commit。
     */
    promotion: TextToImageReferencePromotionService;
}>;

type ReferenceMutationScopeState = {
    active: boolean;
    projectPath: string;
    projectRoot: string;
};

export type TextToImageReferenceLockErrorCode =
    | "REFERENCE_MUTATION_LOCK_NESTED"
    | "REFERENCE_MUTATION_LOCK_INVALID_ROOT"
    | "REFERENCE_MUTATION_LOCK_UNAVAILABLE"
    | "REFERENCE_MUTATION_SCOPE_INVALID";

/** 供后续 API mapper 稳定识别的引用资产锁错误。 */
export class TextToImageReferenceLockError extends Error {
    readonly code: TextToImageReferenceLockErrorCode;

    constructor(code: TextToImageReferenceLockErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TextToImageReferenceLockError";
        this.code = code;
    }
}

const activeMutation = new AsyncLocalStorage<boolean>();
const mutationScopes = new WeakMap<object, ReferenceMutationScopeState>();
const LOCK_TARGET_NAME = ".mutation-lock-target";

/**
 * 锁选项。
 *
 * `requireOpenProject` 默认 true：用户驱动操作（上传/删除/导入）必须绑定当前打开的 Project。
 * 后台 Provider lane 的 Vibe encoding 缓存写入（paid window 内）不依赖 Project session，
 * 传 false 跳过 assertProjectOpen，但锁目标文件本身仍是同一磁盘路径，保证跨操作串行。
 */
export type TextToImageReferenceMutationLockOptions = Readonly<{
    requireOpenProject?: boolean;
}>;

/**
 * 在当前打开 Project 的稳定磁盘目标上取得跨实例排他锁，并把临时 capability 交给回调。
 */
export async function withTextToImageReferenceMutationLock<TResult>(
    projectPath: string,
    operation: (scope: TextToImageReferenceMutationScope) => Promise<TResult>,
    options: TextToImageReferenceMutationLockOptions = {},
): Promise<TResult> {
    if (activeMutation.getStore()) {
        throw new TextToImageReferenceLockError(
            "REFERENCE_MUTATION_LOCK_NESTED",
            "引用资产 mutation lock 不允许嵌套获取",
        );
    }
    if (options.requireOpenProject !== false) {
        assertProjectOpen(textToImageProjectRef(projectPath));
    }
    const projectRoot = absoluteFsPath(await resolveWorkspaceRootInput({projectPath}));
    const lockTarget = resolveContainedFilePath(
        projectRoot,
        `${TEXT_TO_IMAGE_REFERENCE_ASSET_ROOT}/${LOCK_TARGET_NAME}`,
    );

    try {
        await assertRealPathContained(projectRoot, lockTarget);
        await mkdir(path.dirname(lockTarget), {recursive: true});
        const lockTargetFile = await open(lockTarget, "a");
        await lockTargetFile.close();
        await assertRealPathContained(projectRoot, lockTarget);
    } catch (error) {
        throw new TextToImageReferenceLockError(
            "REFERENCE_MUTATION_LOCK_INVALID_ROOT",
            "引用资产锁目录不在当前 Project 的真实根目录内",
            {cause: error},
        );
    }

    let release: () => Promise<void>;
    try {
        release = await lock(lockTarget, {
            realpath: false,
            stale: 30_000,
            update: 10_000,
            retries: {
                retries: 50,
                factor: 1.2,
                minTimeout: 20,
                maxTimeout: 250,
                randomize: true,
            },
        });
    } catch (error) {
        throw new TextToImageReferenceLockError(
            "REFERENCE_MUTATION_LOCK_UNAVAILABLE",
            "无法取得引用资产 mutation lock",
            {cause: error},
        );
    }

    // scope 先占位，promotion port 用闭包 getter 延迟引用冻结后的 scope 本体。
    // 惰性动态 import 打破 lock ↔ promotion.service ↔ reference-asset.service 的模块环。
    const {TextToImageReferencePromotionService} = await import("./reference-promotion.service");
    const scope = {} as TextToImageReferenceMutationScope & {promotion?: TextToImageReferencePromotionService};
    let frozenScope!: TextToImageReferenceMutationScope;
    const promotion = new TextToImageReferencePromotionService(() => frozenScope);
    scope.promotion = promotion;
    frozenScope = Object.freeze({...scope});
    const state: ReferenceMutationScopeState = {
        active: true,
        projectPath,
        projectRoot: normalizeRoot(projectRoot),
    };
    mutationScopes.set(frozenScope, state);
    try {
        return await activeMutation.run(true, () => operation(frozenScope));
    } finally {
        state.active = false;
        mutationScopes.delete(frozenScope);
        await release();
    }
}

/** 在真正写入前校验 scope 仍活跃且绑定到完全相同的 Project/root。 */
export function assertTextToImageReferenceMutationScope(
    scope: TextToImageReferenceMutationScope,
    input: {projectPath: string; projectRoot: string},
): void {
    const state = mutationScopes.get(scope);
    if (!state?.active
        || state.projectPath !== input.projectPath
        || state.projectRoot !== normalizeRoot(input.projectRoot)) {
        throw new TextToImageReferenceLockError(
            "REFERENCE_MUTATION_SCOPE_INVALID",
            "引用资产 mutation scope 无效或不属于当前 Project",
        );
    }
}

/** Windows 路径比较不区分大小写；其它平台保留大小写语义。 */
function normalizeRoot(root: string): string {
    const normalized = path.resolve(root);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
