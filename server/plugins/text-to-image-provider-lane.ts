import {defineNitroPlugin} from "nitropack/runtime";
import {appLogger} from "nbook/server/app-logs/logger";
import {prisma} from "nbook/server/utils/prisma";
import {PrismaDispatchPreparationRepository} from "nbook/server/text-to-image/dispatch-preparation.repository";
import {DispatchReconciler} from "nbook/server/text-to-image/dispatch-reconciler";
import {IllustrationDispatchWorker} from "nbook/server/text-to-image/illustration-dispatch.worker";
import {ProjectDispatchRepository} from "nbook/server/text-to-image/project-dispatch.repository";
import {ProjectIllustrationDispatch} from "nbook/server/text-to-image/project-illustration-dispatch";
import {ProviderLaneRepository} from "nbook/server/text-to-image/provider-lane.repository";
import {ProviderLaneRuntime} from "nbook/server/text-to-image/provider-lane.runtime";
import {ProjectTextToImageProviderJobReconciler} from "nbook/server/text-to-image/provider-reconciliation.service";
import {
    ProviderRevisionInvalidationReconciler,
} from "nbook/server/text-to-image/provider-revision-invalidation.reconciler";
import {PrismaTextToImageProviderStore} from "nbook/server/text-to-image/provider.service";

const globalState = globalThis as typeof globalThis & {
    __nbookTextToImageProviderLane?: {
        runtime: ProviderLaneRuntime;
        owners: Set<object>;
    };
};

/** 启动 Route B 持久 Provider lane；正确性由 App/Project DB lease、revision 与 fence 保证。 */
export default defineNitroPlugin((nitroApp) => {
    const owner = nitroApp as object;
    const existingState = globalState.__nbookTextToImageProviderLane;
    if (existingState) {
        if (existingState.owners.has(owner)) return;
        existingState.owners.add(owner);
        nitroApp.hooks.hook("close", async () => {
            existingState.owners.delete(owner);
            if (existingState.owners.size > 0) return;
            await existingState.runtime.stop();
            if (globalState.__nbookTextToImageProviderLane === existingState) {
                delete globalState.__nbookTextToImageProviderLane;
            }
            await appLogger.info("text-to-image.provider-lane.stopped", undefined, "Route B 文生图 Provider lane 已停止");
        });
        return;
    }
    const lifecycle = new AbortController();
    const preparation = new PrismaDispatchPreparationRepository(prisma);
    const projectDispatch = new ProjectIllustrationDispatch({
        signalFactory: () => AbortSignal.any([lifecycle.signal, AbortSignal.timeout(110_000)]),
    });
    const lane = new ProviderLaneRepository(prisma);
    const runtime = new ProviderLaneRuntime({
        preparation: new DispatchReconciler({
            preparation,
            project: new ProjectDispatchRepository(),
        }),
        revisions: new ProviderRevisionInvalidationReconciler({
            store: new PrismaTextToImageProviderStore(prisma),
            project: new ProjectTextToImageProviderJobReconciler(),
        }),
        lane,
        project: projectDispatch,
        worker: new IllustrationDispatchWorker({lane, project: projectDispatch}),
        logger: appLogger,
        abortActive: () => lifecycle.abort(new Error("Nitro lifecycle closed")),
    });
    const state = {runtime, owners: new Set<object>([owner])};
    globalState.__nbookTextToImageProviderLane = state;
    runtime.start();
    void appLogger.info("text-to-image.provider-lane.started", undefined, "Route B 文生图 Provider lane 已启动");

    nitroApp.hooks.hook("close", async () => {
        state.owners.delete(owner);
        if (state.owners.size > 0) return;
        await runtime.stop();
        if (globalState.__nbookTextToImageProviderLane === state) {
            delete globalState.__nbookTextToImageProviderLane;
        }
        await appLogger.info("text-to-image.provider-lane.stopped", undefined, "Route B 文生图 Provider lane 已停止");
    });
});
