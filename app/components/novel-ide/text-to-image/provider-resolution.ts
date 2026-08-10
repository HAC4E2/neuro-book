import type {
    TextToImageGlobalConfig,
    TextToImageProviderDto,
    TextToImageProviderKind,
    TextToImageRequestType,
} from "nbook/shared/dto/text-to-image.dto";

type TextToImageProviderRef = Pick<TextToImageProviderDto, "id" | "kind">;

/** 按请求类型绑定解析 Provider；未绑定时仅允许唯一候选，避免按列表顺序误用 Provider。 */
export function resolveTextToImageProviderId(
    providers: ReadonlyArray<TextToImageProviderRef>,
    config: Pick<TextToImageGlobalConfig, "requestTypeBindings">,
    requestType: TextToImageRequestType,
    kind: TextToImageProviderKind,
): number | null {
    const candidates = providers.filter((provider) => provider.kind === kind);
    if (candidates.length === 0) {
        return null;
    }

    const binding = config.requestTypeBindings?.[requestType];
    if (binding?.providerId !== null && binding?.providerId !== undefined) {
        return candidates.find((provider) => provider.id === binding.providerId)?.id ?? null;
    }

    return candidates.length === 1 ? candidates[0]!.id : null;
}
