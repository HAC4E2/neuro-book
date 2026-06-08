import {ProjectRagMemoryWriteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {createProjectRagMemory} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新增 subject memory。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagMemoryWriteRequestDtoSchema);
    const result = await createProjectRagMemory(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
