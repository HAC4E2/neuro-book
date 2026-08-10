import {readTextToImageAssetBytesByRelativePath} from "nbook/server/text-to-image/asset.service";
import {readTextToImageMaskBytes} from "nbook/server/text-to-image/mask.service";
import type {TextToImageReferenceResolver} from "nbook/server/text-to-image/novelai-image-generation";
import {readTextToImageReferenceImageBytes} from "nbook/server/text-to-image/reference-image.service";

const REFERENCE_IMAGE_PREFIX = "text-to-image/reference-images/";
const MASK_PREFIX = "assets/tti-masks/";

/** Resolver combines global reference images, project masks and generated assets. */
export function createTextToImageReferenceResolver(projectPath: string): TextToImageReferenceResolver {
    return {
        readReference: (relativePath: string): Promise<Uint8Array> => {
            if (relativePath.startsWith(REFERENCE_IMAGE_PREFIX)) {
                return readTextToImageReferenceImageBytes(relativePath);
            }
            if (relativePath.startsWith(MASK_PREFIX)) {
                return readTextToImageMaskBytes(projectPath, relativePath);
            }
            return readTextToImageAssetBytesByRelativePath(projectPath, relativePath);
        },
    };
}
