import {ProjectRagEventDeleteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {deleteProjectRagEvent} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 删除 subject event。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagEventDeleteRequestDtoSchema);
    const result = await deleteProjectRagEvent(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
