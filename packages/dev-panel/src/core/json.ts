/** 读入库文件与运行时文件时的运行期校验小工具：文件谁都能改，类型声明代替不了检查。 */

const ISO_TIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `toISOString()` 写出的 UTC 时间。 */
export function isIsoTime(value: unknown): value is string {
    return typeof value === "string" && ISO_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** `schema` 是同一族的别的主版本（`nbdev.answer/v2`）时为真：调用方报 `schema_unsupported`，不猜。 */
export function isOtherSchemaVersion(value: unknown, schema: string): boolean {
    const family = schema.slice(0, schema.lastIndexOf("/") + 1);
    return typeof value === "string" && value !== schema && value.startsWith(family);
}
