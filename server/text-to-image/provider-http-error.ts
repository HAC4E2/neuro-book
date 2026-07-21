import {createError} from "h3";
import {
    TextToImageProviderReconciliationInProgressError,
    TextToImageProviderNotConfiguredError,
    TextToImageProviderSelectionRequiredError,
    TextToImageProviderSelectionStaleError,
    TextToImageProviderSingletonConflictError,
} from "nbook/server/text-to-image/provider.service";

/** 把 Provider 领域冲突映射为各 API 入口共享的稳定 409 code。 */
export function resolveTextToImageProviderHttpError(error: unknown): ReturnType<typeof createError> | null {
    if (error instanceof TextToImageProviderReconciliationInProgressError
        || error instanceof TextToImageProviderNotConfiguredError
        || error instanceof TextToImageProviderSelectionRequiredError
        || error instanceof TextToImageProviderSelectionStaleError
        || error instanceof TextToImageProviderSingletonConflictError) {
        return createError({statusCode: 409, message: error.message, data: {code: error.code}});
    }
    return null;
}
