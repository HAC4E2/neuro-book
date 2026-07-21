/** 模型设置页当前支持的受控聚焦目标。 */
export type SettingsModelFocusTarget = "illustration-director";

/**
 * 外部功能打开设置页时使用的严格导航请求。
 * `id` 必须单调递增，使连续点击同一入口也能触发导航。
 */
export type SettingsNavigationRequest = {
    id: number;
    scope: "global";
    section: "models";
    focus: SettingsModelFocusTarget;
};

