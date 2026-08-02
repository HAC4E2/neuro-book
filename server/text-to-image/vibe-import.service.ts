import {TextToImageReferenceAssetService} from "nbook/server/text-to-image/reference-asset.service";
import {parseVibeContainer} from "nbook/server/text-to-image/vibe-container.parser";
import {
    VibeImportResponseSchema,
    type VibeContainerImportPort,
    type VibeImportResponse,
} from "nbook/shared/text-to-image-vibe-container";

/**
 * `.naiv4vibe` / `.vibe` 导入入口：严格解析（第一个非法边界拒绝整个容器），
 * 然后在 Project mutation 锁内 all-or-nothing 发布 source + 全部 encoding。
 */
export class VibeImportService implements VibeContainerImportPort {
    private readonly service: TextToImageReferenceAssetService;

    constructor(service: TextToImageReferenceAssetService = new TextToImageReferenceAssetService()) {
        this.service = service;
    }

    /** 解析并原子导入一个受信字节容器；不改变 Recipe。 */
    async importContainer(input: {
        projectPath: string;
        bytes: Uint8Array;
    }): Promise<VibeImportResponse> {
        const parsed = await parseVibeContainer(input.bytes);
        const result = await this.service.importVibeContainer(input.projectPath, parsed);
        return VibeImportResponseSchema.parse({
            schemaVersion: "nbook.vibe-import-response/v1",
            containerContentHash: parsed.containerContentHash,
            sourceContentHash: result.source.contentHash,
            sourceMimeType: result.source.mimeType,
            sourceWidth: result.source.width,
            sourceHeight: result.source.height,
            providerModel: parsed.providerModel,
            encoderVersion: parsed.encoderVersion,
            suggestedStrength: parsed.suggestedStrength,
            encodingCount: result.encodingCount,
            displayName: parsed.display.name,
            displayCreatedAt: parsed.display.createdAt,
            hasThumbnail: parsed.display.thumbnail !== null,
            sourceAlreadyExists: result.sourceAlreadyExists,
        });
    }
}
