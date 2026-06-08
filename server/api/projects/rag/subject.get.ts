import {readProjectRagSubject} from "nbook/server/rag/project-rag-visualization";
import {ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";

/**
 * 读取单个 subject 的 RAG 数据。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const subjectPath = typeof query.subjectPath === "string" ? query.subjectPath.trim() : "";
    if (!subjectPath) {
        throw createError({statusCode: 400, message: "subjectPath query 不能为空"});
    }
    const result = await readProjectRagSubject(requireProjectPathQuery(event), subjectPath);
    return ProjectRagSubjectDtoSchema.parse(result);
});
