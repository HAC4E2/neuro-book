import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
} from "nbook/server/plot/http/plot-route";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 剧情模块单例门面。
 */
export const plotFacade = new PlotFacade(prisma);

export {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
};
