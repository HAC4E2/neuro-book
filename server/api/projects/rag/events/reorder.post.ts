import {ProjectRagEventReorderRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {reorderProjectRagEvent} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 重排 subject event。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagEventReorderRequestDtoSchema);
    const result = await reorderProjectRagEvent(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
