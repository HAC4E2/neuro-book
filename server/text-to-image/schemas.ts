import {z} from "zod";
import {
    TextToImageGlobalConfigSchema,
    TextToImageProviderKindSchema,
} from "nbook/shared/dto/text-to-image.dto";

/** Provider 新建/更新入参；credential 缺省表示保留已有密文。 */
export const SaveTextToImageProviderSchema = z.object({
    id: z.number().int().optional(),
    kind: TextToImageProviderKindSchema,
    name: z.string().trim().min(1),
    baseUrl: z.string().trim().min(1),
    model: z.string().trim().nullable().optional(),
    credential: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).default({}),
});
export type SaveTextToImageProviderInput = z.infer<typeof SaveTextToImageProviderSchema>;

/** 工作台配置写入入参；只允许更新 textToImage 非敏感面。 */
export const TextToImageWorkbenchConfigPutSchema = TextToImageGlobalConfigSchema.partial();
