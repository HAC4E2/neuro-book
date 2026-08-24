/**
 * 正文生图 L1→L2 的非致命诊断。诊断只描述块序号与处理动作，不能携带完整正文或 Prompt。
 */
export type BodyImageDiagnostic = {
    blockIndex: number;
    code:
        | "block_truncated"
        | "block_invalid"
        | "call_invalid"
        | "anchor_appended"
        | "anchor_first_match";
    action: "skipped" | "inserted";
    message: string;
};
