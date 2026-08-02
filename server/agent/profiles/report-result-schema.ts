import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import type {ProfileToolBinding, ReportResultToolBinding} from "nbook/profile-sdk/contracts";

/**
 * 判断 TypeBox object schema 是否没有定义任何输出字段。
 */
export function isEmptyObjectSchema(schema: TSchema | undefined): boolean {
    if (!schema || typeof schema !== "object") {
        return true;
    }
    if ("anyOf" in schema || "oneOf" in schema || "allOf" in schema || "not" in schema || "$ref" in schema) {
        return false;
    }
    if (!("type" in schema) || schema.type !== "object") {
        return false;
    }
    const properties = "properties" in schema && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
    return Object.keys(properties).length === 0;
}

export type ReportResultDataContract = {
    /** 空 object schema 时为空，表示 report_result 不暴露 data。 */
    schema?: TSchema;
    /** Profile 显式声明 dataSchema 时为 true，模型与执行期都必须提交 data。 */
    required: boolean;
};

/** 解析 Profile 的结构化主路输出合同，统一模型可见 schema 与执行期校验语义。 */
export function reportResultDataContractForProfile(profile: AgentProfile): ReportResultDataContract {
    const binding = profile.tools.report_result;
    const explicitSchema = isReportResultBinding(binding) ? binding.dataSchema : undefined;
    const dataSchema = explicitSchema ?? profile.outputSchema;
    if (isEmptyObjectSchema(dataSchema)) {
        return {required: false};
    }
    return {
        schema: dataSchema,
        required: explicitSchema !== undefined,
    };
}

/**
 * 从目标 profile 的 OutputSchema 派生 report_result 的模型可见参数 schema。
 * dataSchemaOverride 非空时优先（per-session 动态 schema：adhoc profile 从 initial 解析）。
 */
export function reportResultSchemaForProfile(profile: AgentProfile, dataSchemaOverride?: TSchema): TSchema {
    // 动态 override（adhoc 从 initial 解析）是调用方合同，必须返回；
    // 静态路径沿用 dataContract：显式 dataSchema 必填，仅 outputSchema 推导时可选。
    const dataContract: ReportResultDataContract = dataSchemaOverride !== undefined
        ? {schema: dataSchemaOverride, required: true}
        : reportResultDataContractForProfile(profile);
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...dataContract.schema === undefined
            ? {}
            : {
                data: dataContract.required
                    ? dataContract.schema
                    : Type.Optional(dataContract.schema),
            },
    };
    return Type.Object(properties);
}

function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && binding.key === "report_result" && "dataSchema" in binding);
}
