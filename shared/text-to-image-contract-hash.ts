import {createHash} from "node:crypto";

export type TextToImageContractValue = null | boolean | number | string | TextToImageContractValue[] | {
    [key: string]: TextToImageContractValue;
};

/**
 * 对已经通过 strict schema 的 JSON 合同做递归 key 排序。
 *
 * 数组顺序属于业务语义；对象 key 顺序不属于业务语义。
 */
export function canonicalizeTextToImageContract(value: TextToImageContractValue): string {
    return canonicalize(value);
}

/** 为规范合同生成带算法前缀的 SHA-256。 */
export function hashTextToImageContract(value: TextToImageContractValue): string {
    return `sha256:${createHash("sha256").update(canonicalizeTextToImageContract(value), "utf8").digest("hex")}`;
}

/**
 * 即使调用方来自未类型化的外部边界，也只接受 plain JSON value。
 * 这里使用 unknown 是为了在递归校验完成前不把 Date/class/undefined 误当合同值。
 */
function canonicalize(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("合同数字必须是有限值");
        }
        return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!(index in value)) {
                throw new Error("合同数组不能包含空槽位");
            }
        }
        return `[${value.map((item) => canonicalize(item)).join(",")}]`;
    }
    if (typeof value !== "object") {
        throw new Error("合同值必须是 JSON-compatible value");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("合同对象必须是 plain object");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error("合同对象不能包含 symbol key");
    }
    const contractObject = value as {[key: string]: unknown};
    return `{${Object.keys(contractObject).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(contractObject[key])}`).join(",")}}`;
}
