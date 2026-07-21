import {createHash} from "node:crypto";
import {
    canonicalizeTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";

export const CHATU8_STORYBOARD_JSON_LIMITS = {
    maxBytes: 16 * 1024 * 1024,
    maxDepth: 64,
    maxEntries: 10000,
    maxStringLength: 120000,
} as const;

export type Chatu8StoryboardJsonErrorCode =
    | "STORYBOARD_IMPORT_FILE_TOO_LARGE"
    | "STORYBOARD_IMPORT_UTF8_INVALID"
    | "STORYBOARD_IMPORT_JSON_INVALID"
    | "STORYBOARD_IMPORT_JSON_DUPLICATE_KEY"
    | "STORYBOARD_IMPORT_JSON_UNSAFE_KEY"
    | "STORYBOARD_IMPORT_JSON_DEPTH_EXCEEDED"
    | "STORYBOARD_IMPORT_JSON_STRING_TOO_LONG"
    | "STORYBOARD_IMPORT_JSON_UNSAFE_NUMBER"
    | "STORYBOARD_IMPORT_ENTRY_LIMIT_EXCEEDED"
    | "STORYBOARD_IMPORT_SHAPE_UNSUPPORTED";

/** Chatu8 Storyboard JSON 的稳定严格解析错误。 */
export class Chatu8StoryboardJsonError extends Error {
    readonly code: Chatu8StoryboardJsonErrorCode;

    constructor(code: Chatu8StoryboardJsonErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "Chatu8StoryboardJsonError";
        this.code = code;
    }
}

export type ParsedChatu8StoryboardJson = {
    sourceShape: "direct_entries" | "wrapped_entries";
    sourcePresetKey: string;
    entries: Chatu8JsonEntrySource[];
    sanitizedValue: TextToImageContractValue;
    sanitizedBytes: Uint8Array;
    rawSourceHash: string;
    sanitizedSourceHash: string;
    secretPaths: string[];
};

export type ParsedStrictChatu8JsonDocument = {
    sanitizedValue: TextToImageContractValue;
    sanitizedBytes: Uint8Array;
    rawSourceHash: string;
    sanitizedSourceHash: string;
    secretPaths: string[];
};

export type Chatu8JsonObject = {[key: string]: TextToImageContractValue};

export type Chatu8JsonEntrySource = {
    /** entries 为 array 时是 null；为 map 时保存稳定 map key。 */
    mapKey: string | null;
    sourceOrder: number;
    jsonPointer: string;
    value: Chatu8JsonObject;
};

type JsonObject = Chatu8JsonObject;

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_KEYS = new Set([
    "apikey",
    "accesstoken",
    "refreshtoken",
    "token",
    "secret",
    "clientsecret",
    "password",
    "authorization",
    "cookie",
]);

/**
 * 读取并严格解析 Chatu8 Storyboard JSON。
 *
 * duplicate key 与 prototype key 在 token 层拒绝；原始 bytes 只用于内存 hash，返回的可持久化 bytes 已递归脱敏并 canonicalize。
 */
export function parseChatu8StoryboardJson(bytes: Uint8Array): ParsedChatu8StoryboardJson {
    const document = parseStrictChatu8JsonDocument(bytes);
    const shape = resolveEntriesShape(document.sanitizedValue);
    if (shape.entries.length > CHATU8_STORYBOARD_JSON_LIMITS.maxEntries) {
        throw new Chatu8StoryboardJsonError(
            "STORYBOARD_IMPORT_ENTRY_LIMIT_EXCEEDED",
            `entries 超过 ${String(CHATU8_STORYBOARD_JSON_LIMITS.maxEntries)} 条`,
        );
    }
    return {...shape, ...document};
}

/**
 * 读取 Chatu8 公开导出共用的 strict JSON document 边界。
 *
 * 本函数只负责 JSON 安全、上限、secret redaction 与 canonical hash；具体 Storyboard/角色 source shape 由各自 parser 再收窄。
 */
export function parseStrictChatu8JsonDocument(bytes: Uint8Array): ParsedStrictChatu8JsonDocument {
    if (bytes.byteLength > CHATU8_STORYBOARD_JSON_LIMITS.maxBytes) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_FILE_TOO_LARGE", "文件超过 16 MiB 上限");
    }

    let text: string;
    try {
        text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_UTF8_INVALID", "文件不是严格 UTF-8");
    }

    const parsed = new StrictJsonParser(text).parse();
    const secretPaths: string[] = [];
    const sanitizedValue = redactSecrets(parsed, "", secretPaths);
    secretPaths.sort();
    const canonicalSanitized = canonicalizeTextToImageContract(sanitizedValue);
    const sanitizedBytes = new TextEncoder().encode(canonicalSanitized);
    return {
        sanitizedValue,
        sanitizedBytes,
        rawSourceHash: sha256(bytes),
        sanitizedSourceHash: sha256(sanitizedBytes),
        secretPaths,
    };
}

/** 递归下降 JSON parser；不允许标准 JSON 之外的注释、尾逗号或非有限数字。 */
class StrictJsonParser {
    private index = 0;

    constructor(private readonly text: string) {}

    /** 解析唯一根值并确认没有尾随 token。 */
    parse(): TextToImageContractValue {
        this.skipWhitespace();
        const value = this.parseValue(1);
        this.skipWhitespace();
        if (this.index !== this.text.length) {
            this.invalid("根值后存在多余内容");
        }
        return value;
    }

    /** 按当前 token 解析一个 JSON value，并统一执行深度上限。 */
    private parseValue(depth: number): TextToImageContractValue {
        if (depth > CHATU8_STORYBOARD_JSON_LIMITS.maxDepth) {
            throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_DEPTH_EXCEEDED", "JSON 嵌套过深");
        }
        this.skipWhitespace();
        const token = this.text[this.index];
        if (token === "{") return this.parseObject(depth);
        if (token === "[") return this.parseArray(depth);
        if (token === '"') return this.parseString();
        if (token === "t") return this.parseLiteral("true", true);
        if (token === "f") return this.parseLiteral("false", false);
        if (token === "n") return this.parseLiteral("null", null);
        if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) return this.parseNumber();
        this.invalid("遇到非法 JSON token");
    }

    /** 解析 object，并在写入前检测 duplicate/prototype key。 */
    private parseObject(depth: number): JsonObject {
        this.expect("{");
        const result: JsonObject = Object.create(null) as JsonObject;
        const keys = new Set<string>();
        this.skipWhitespace();
        if (this.consume("}")) return result;

        while (true) {
            this.skipWhitespace();
            if (this.text[this.index] !== '"') this.invalid("object key 必须是字符串");
            const key = this.parseString();
            if (UNSAFE_KEYS.has(key)) {
                throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_UNSAFE_KEY", `禁止的 object key：${key}`);
            }
            if (keys.has(key)) {
                throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_DUPLICATE_KEY", `重复 object key：${key}`);
            }
            keys.add(key);
            this.skipWhitespace();
            this.expect(":");
            result[key] = this.parseValue(depth + 1);
            this.skipWhitespace();
            if (this.consume("}")) return result;
            this.expect(",");
        }
    }

    /** 解析 array；空槽位与尾逗号会自然落入非法 token。 */
    private parseArray(depth: number): TextToImageContractValue[] {
        this.expect("[");
        const result: TextToImageContractValue[] = [];
        this.skipWhitespace();
        if (this.consume("]")) return result;

        while (true) {
            result.push(this.parseValue(depth + 1));
            this.skipWhitespace();
            if (this.consume("]")) return result;
            this.expect(",");
        }
    }

    /** 使用原生 JSON string 解码单个已验证 token，并拒绝过长/孤立 surrogate。 */
    private parseString(): string {
        const start = this.index;
        this.expect('"');
        while (this.index < this.text.length) {
            const character = this.text[this.index]!;
            if (character === '"') {
                this.index += 1;
                const token = this.text.slice(start, this.index);
                let value: string;
                try {
                    value = JSON.parse(token) as string;
                } catch {
                    this.invalid("字符串 escape 非法");
                }
                if (value.length > CHATU8_STORYBOARD_JSON_LIMITS.maxStringLength) {
                    throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_STRING_TOO_LONG", "JSON 字符串超过上限");
                }
                if (hasUnpairedSurrogate(value)) {
                    this.invalid("字符串包含孤立 surrogate");
                }
                return value;
            }
            if (character === "\\") {
                this.index += 1;
                const escaped = this.text[this.index];
                if (escaped === undefined) this.invalid("字符串 escape 未闭合");
                if (escaped === "u") {
                    const hex = this.text.slice(this.index + 1, this.index + 5);
                    if (!/^[a-f0-9]{4}$/iu.test(hex)) this.invalid("Unicode escape 非法");
                    this.index += 5;
                    continue;
                }
                if (!/["\\/bfnrt]/u.test(escaped)) this.invalid("字符串 escape 非法");
                this.index += 1;
                continue;
            }
            if (character.charCodeAt(0) <= 0x1f) this.invalid("字符串包含未转义控制字符");
            this.index += 1;
        }
        this.invalid("字符串未闭合");
    }

    /** 解析标准 JSON number，并拒绝丢失精度的整数。 */
    private parseNumber(): number {
        const matched = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(this.text.slice(this.index));
        if (!matched) this.invalid("数字格式非法");
        this.index += matched[0].length;
        const value = Number(matched[0]);
        if (!Number.isFinite(value)) this.invalid("数字必须是有限值");
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_UNSAFE_NUMBER", "整数超出安全精度");
        }
        return Object.is(value, -0) ? 0 : value;
    }

    /** 解析 true/false/null 固定字面量。 */
    private parseLiteral<TValue extends boolean | null>(literal: string, value: TValue): TValue {
        if (!this.text.startsWith(literal, this.index)) this.invalid(`期望 ${literal}`);
        this.index += literal.length;
        return value;
    }

    /** 跳过 JSON 标准允许的四种空白。 */
    private skipWhitespace(): void {
        while (/[\u0009\u000a\u000d\u0020]/u.test(this.text[this.index] ?? "")) this.index += 1;
    }

    /** 精确消费一个可选分隔符。 */
    private consume(expected: string): boolean {
        if (this.text[this.index] !== expected) return false;
        this.index += 1;
        return true;
    }

    /** 要求当前位置为指定分隔符。 */
    private expect(expected: string): void {
        if (!this.consume(expected)) this.invalid(`期望 ${expected}`);
    }

    /** 抛出不包含外部原文的稳定 JSON 语法错误。 */
    private invalid(message: string): never {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_JSON_INVALID", `${message}（offset ${String(this.index)}）`);
    }
}

/** 递归复制并删除 secret key；source object 不在原地修改。 */
function redactSecrets(
    value: TextToImageContractValue,
    pointer: string,
    secretPaths: string[],
): TextToImageContractValue {
    if (Array.isArray(value)) {
        return value.map((item, index) => redactSecrets(item, `${pointer}/${String(index)}`, secretPaths));
    }
    if (!isJsonObject(value)) return value;

    const result: JsonObject = Object.create(null) as JsonObject;
    for (const key of Object.keys(value)) {
        const childPointer = `${pointer}/${escapeJsonPointer(key)}`;
        if (isSecretKey(key)) {
            secretPaths.push(childPointer);
            continue;
        }
        result[key] = redactSecrets(value[key]!, childPointer, secretPaths);
    }
    return result;
}

/** 解析 direct entries 或单 dynamic wrapper 两种冻结入口。 */
function resolveEntriesShape(value: TextToImageContractValue): Pick<ParsedChatu8StoryboardJson, "sourceShape" | "sourcePresetKey" | "entries"> {
    if (!isJsonObject(value)) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "根值必须是 object");
    }
    const directEntries = value.entries;
    if (directEntries !== undefined && (Array.isArray(directEntries) || isJsonObject(directEntries))) {
        const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "direct";
        if (name.length > 500) {
            throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "source preset key 过长");
        }
        return {
            sourceShape: "direct_entries",
            sourcePresetKey: name,
            entries: resolveEntrySources(directEntries, "/entries"),
        };
    }

    const keys = Object.keys(value);
    if (keys.length !== 1) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "动态 wrapper 根必须只有一个 key");
    }
    const sourcePresetKey = keys[0]!;
    const wrapped = value[sourcePresetKey];
    if (wrapped === undefined || !isJsonObject(wrapped)) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "动态 wrapper value 必须包含 entries array/map");
    }
    const wrappedEntries = wrapped.entries;
    if (wrappedEntries === undefined || (!Array.isArray(wrappedEntries) && !isJsonObject(wrappedEntries))) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "动态 wrapper value 必须包含 entries array/map");
    }
    if (sourcePresetKey.length > 500) {
        throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "source preset key 过长");
    }
    return {
        sourceShape: "wrapped_entries",
        sourcePresetKey,
        entries: resolveEntrySources(wrappedEntries, `/${escapeJsonPointer(sourcePresetKey)}/entries`),
    };
}

/** 把 array/map entries 统一成保留 mapKey/sourceOrder/JSON Pointer 的严格来源列表。 */
function resolveEntrySources(value: TextToImageContractValue, pointer: string): Chatu8JsonEntrySource[] {
    if (Array.isArray(value)) {
        return value.map((entry, sourceOrder) => {
            if (!isJsonObject(entry)) {
                throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "entries 的每一项都必须是 object");
            }
            return {mapKey: null, sourceOrder, jsonPointer: `${pointer}/${String(sourceOrder)}`, value: entry};
        });
    }
    if (isJsonObject(value)) {
        return Object.keys(value).map((mapKey, sourceOrder) => {
            const entry = value[mapKey]!;
            if (!isJsonObject(entry)) {
                throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "entries map 的每个 value 都必须是 object");
            }
            return {
                mapKey,
                sourceOrder,
                jsonPointer: `${pointer}/${escapeJsonPointer(mapKey)}`,
                value: entry,
            };
        });
    }
    throw new Chatu8StoryboardJsonError("STORYBOARD_IMPORT_SHAPE_UNSUPPORTED", "entries 必须是 array 或 map");
}

/** 判断一个 strict JSON value 是否为非数组 object。 */
function isJsonObject(value: TextToImageContractValue): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 统一 secret key 形态，避免 snake/camel/case 变化绕过。 */
function isSecretKey(key: string): boolean {
    return SECRET_KEYS.has(key.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, ""));
}

/** JSON Pointer 转义。 */
function escapeJsonPointer(value: string): string {
    return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

/** 检查 JSON.parse 会接受但 canonical UTF-8 无法保真的孤立 surrogate。 */
function hasUnpairedSurrogate(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}

/** 计算原始或 canonical sanitized bytes 的带前缀 SHA-256。 */
function sha256(value: Uint8Array): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
