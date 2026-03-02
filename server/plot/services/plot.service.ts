import type {PlotRepository, SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStoryPlotInput,
    ParsedReorderStoryPlotItem,
    ParsedUpdateStoryPlotInput,
} from "nbook/server/plot/core/types";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {
    PlotTreeDto,
    StoryPlotDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Plot 用例服务。
 */
export class PlotService {
    constructor(
        private readonly plotRepository: PlotRepository,
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly orderService: OrderService,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 查询情节点详情。
     */
    async getStoryPlotDto(novelId: number, plotId: number): Promise<StoryPlotDto> {
        const story = await this.storyService.ensureStory(novelId);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        return this.assembler.toStoryPlotDto(plot);
    }

    /**
     * 创建情节点。
     */
    async createStoryPlot(novelId: number, input: ParsedCreateStoryPlotInput): Promise<StoryPlotDto> {
        const story = await this.storyService.ensureStory(novelId);
        await this.scopeGuard.assertScene(story.id, input.sceneId);
        await this.plotRepository.lockPlotOrderBucket(input.sceneId);

        const plot = await this.plotRepository.createPlot({
            sceneId: input.sceneId,
            sortOrder: await this.orderService.getNextPlotSortOrder(input.sceneId),
            kind: input.kind,
            summary: input.summary ?? "",
            effect: input.effect ?? null,
            writingTip: input.writingTip ?? null,
            note: input.note ?? null,
        });

        return this.assembler.toStoryPlotDto(plot);
    }

    /**
     * 更新情节点。
     */
    async updateStoryPlot(
        novelId: number,
        plotId: number,
        patch: ParsedUpdateStoryPlotInput,
    ): Promise<StoryPlotDto> {
        const story = await this.storyService.ensureStory(novelId);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        const nextSceneId = patch.sceneId === undefined ? plot.sceneId : patch.sceneId;
        const sceneChanged = nextSceneId !== plot.sceneId;

        if (sceneChanged) {
            await this.scopeGuard.assertScene(story.id, nextSceneId);
        }

        const updatedPlot = await this.plotRepository.updatePlot(plot.id, {
            sceneId: nextSceneId,
            sortOrder: sceneChanged ? await this.orderService.getNextPlotSortOrder(nextSceneId) : undefined,
            kind: patch.kind,
            summary: patch.summary,
            effect: patch.effect,
            writingTip: patch.writingTip,
            note: patch.note,
        });

        if (sceneChanged) {
            await this.orderService.normalizePlots(plot.sceneId);
        }

        return this.assembler.toStoryPlotDto(updatedPlot);
    }

    /**
     * 删除情节点。
     */
    async deleteStoryPlot(novelId: number, plotId: number): Promise<void> {
        const story = await this.storyService.ensureStory(novelId);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        await this.plotRepository.deletePlot(plot.id);
        await this.orderService.normalizePlots(plot.sceneId);
    }

    /**
     * 批量重排情节点。
     */
    async reorderStoryPlots(novelId: number, items: ParsedReorderStoryPlotItem[]): Promise<PlotTreeDto> {
        const story = await this.storyService.ensureStory(novelId);
        const [existingPlotIds, existingSceneIds] = await Promise.all([
            this.plotRepository.findPlotIdsByStory(story.id),
            this.sceneRepository.findSceneIdsByStory(story.id),
        ]);
        const parsedItems = this.orderService.validatePlotReorderItems(existingPlotIds, existingSceneIds, items);

        for (const item of parsedItems) {
            await this.plotRepository.updatePlot(item.plotId, {
                sceneId: item.sceneId,
                sortOrder: item.sortOrder,
            });
        }

        return this.storyService.getPlotTree(novelId);
    }
}
