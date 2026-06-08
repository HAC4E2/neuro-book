import {readProjectRagOverview} from "nbook/server/rag/project-rag-visualization";
import {ProjectRagOverviewDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";

/**
 * 读取当前 Project 的 RAG 可视化概览。
 */
export default defineEventHandler(async (event) => {
    const result = await readProjectRagOverview(requireProjectPathQuery(event));
    return ProjectRagOverviewDtoSchema.parse(result);
});
