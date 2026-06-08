import {ProjectRagMemoryDeleteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {deleteProjectRagMemory} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 删除 subject memory。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagMemoryDeleteRequestDtoSchema);
    const result = await deleteProjectRagMemory(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
