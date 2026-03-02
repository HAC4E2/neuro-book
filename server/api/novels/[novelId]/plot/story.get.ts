import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade} from "nbook/server/plot";

/**
 * 查询 Story 基本信息。
 */
export default defineEventHandler(async (event) => {
    return plotFacade.getStoryDto(requireNovelId(event));
});
