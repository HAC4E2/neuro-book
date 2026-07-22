import {createError, getQuery} from "h3";
import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS, type TextToImageReferenceAssetKind} from "nbook/shared/text-to-image-reference-asset";

/** 列出 Project 参考资产元数据；不返回 bytes。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath.trim() : "";
    if (!projectPath) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    assertProjectOpen(projectPath);
    const rawKind = typeof query.kind === "string" ? query.kind : undefined;
    const kind = rawKind && (TEXT_TO_IMAGE_REFERENCE_ASSET_KINDS as readonly string[]).includes(rawKind)
        ? rawKind as TextToImageReferenceAssetKind
        : undefined;
    const page = typeof query.page === "string" && /^\d+$/u.test(query.page) ? Number(query.page) : undefined;
    const pageSize = typeof query.pageSize === "string" && /^\d+$/u.test(query.pageSize) ? Number(query.pageSize) : undefined;
    return new TextToImageReferenceAssetService().list({projectPath, kind, page, pageSize});
});
