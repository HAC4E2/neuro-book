import {nbColorwayVarKeys} from "../../../src/colorway/colorway-contract";
import {
    nbElevationTokens,
    nbMotionTokens,
    nbRadiusTokens,
    nbSpacingTokens,
    nbThemeDecorTokens,
    nbThemeMetricTokens,
    nbThemeRoleTokens,
    nbTypographyTokens,
} from "../../../src/theme/tokens";

export type LabComponentId = "form-input" | "form-number-input" | "form-select" | "form-checkbox";
export type LabViewportId = "responsive" | "phone" | "tablet";
export type LabControlType = "boolean" | "text" | "select";

export type LabOption = {
    label: string;
    value: string;
};

export type LabPropControl = {
    id: string;
    label: string;
    type: LabControlType;
    options?: readonly LabOption[];
};

export type LabScene = {
    id: string;
    label: string;
};

export type LabComponentDefinition = {
    id: LabComponentId;
    label: string;
    group: string;
    description: string;
    scenes: LabScene[];
    controls: LabPropControl[];
    targetSelector: string;
    events: string[];
};

const sizeOptions = [
    {label: "默认", value: "default"},
    {label: "紧凑", value: "sm"},
] as const;

const directionOptions = [
    {label: "自动", value: "auto"},
    {label: "向上", value: "up"},
    {label: "向下", value: "down"},
] as const;

export const labComponents: LabComponentDefinition[] = [
    {
        id: "form-input",
        label: "FormInput",
        group: "表单",
        description: "文本、搜索、密码与数字字符串输入；支持前缀、只读和字段错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "prefix", label: "前缀"},
            {id: "invalid", label: "错误"},
            {id: "disabled", label: "禁用"},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "type", label: "类型", type: "select", options: [
                {label: "文本", value: "text"},
                {label: "搜索", value: "search"},
                {label: "密码", value: "password"},
                {label: "数字", value: "number"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "form-number-input",
        label: "FormNumberInput",
        group: "表单",
        description: "保留编辑中间态的数字字符串输入；支持步进、边界和 Enter 提交。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "bounded", label: "边界"},
            {id: "invalid", label: "错误"},
            {id: "disabled", label: "禁用"},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", options: sizeOptions},
            {id: "step", label: "步进", type: "text"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "submit"],
    },
    {
        id: "form-select",
        label: "FormSelect",
        group: "表单",
        description: "Reka Select 选择器；支持说明、图标、方向、紧凑尺寸与禁用项。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "rich", label: "丰富选项"},
            {id: "invalid", label: "错误"},
            {id: "disabled", label: "禁用"},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "hideCheckmark", label: "隐藏勾选", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", options: sizeOptions},
            {id: "direction", label: "展开方向", type: "select", options: directionOptions},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "form-checkbox",
        label: "FormCheckbox",
        group: "表单",
        description: "布尔字段；支持可选文字、true/false 回退、禁用和错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "fallback", label: "值回退"},
            {id: "invalid", label: "错误"},
            {id: "disabled", label: "禁用"},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "label", label: "标签", type: "text"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
];

export const labViewports: {id: LabViewportId; label: string; width: number | null}[] = [
    {id: "responsive", label: "自适应", width: null},
    {id: "phone", label: "390", width: 390},
    {id: "tablet", label: "768", width: 768},
];

export type LabTokenGroup = {
    id: string;
    label: string;
    tokens: readonly string[];
};

const colorwayGroups: LabTokenGroup[] = [
    {id: "colorway-surface", label: "配色 · 表面", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--bg-") || token === "--color-scheme")},
    {id: "colorway-text", label: "配色 · 文字", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--text-"))},
    {id: "colorway-border", label: "配色 · 描边", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--border-"))},
    {id: "colorway-accent", label: "配色 · 强调", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--accent-"))},
    {id: "colorway-status", label: "配色 · 状态", tokens: nbColorwayVarKeys.filter((token) => token.startsWith("--status-"))},
    {id: "colorway-other", label: "配色 · 其他", tokens: nbColorwayVarKeys.filter((token) => !token.startsWith("--bg-") && !token.startsWith("--text-") && !token.startsWith("--border-") && !token.startsWith("--accent-") && !token.startsWith("--status-") && token !== "--color-scheme")},
];

export const labCoreTokenGroups: LabTokenGroup[] = [
    ...colorwayGroups,
    {id: "typography", label: "设计 · 排版", tokens: nbTypographyTokens},
    {id: "spacing", label: "设计 · 间距", tokens: nbSpacingTokens},
    {id: "radius", label: "设计 · 圆角", tokens: nbRadiusTokens},
    {id: "elevation", label: "设计 · 层级", tokens: nbElevationTokens},
    {id: "motion", label: "设计 · 动效", tokens: nbMotionTokens},
    {id: "theme-metric", label: "主题 · 度量", tokens: nbThemeMetricTokens},
    {id: "theme-decor", label: "主题 · 装饰", tokens: nbThemeDecorTokens},
    {id: "theme-role", label: "主题 · 角色", tokens: nbThemeRoleTokens},
];

export function isLabComponentId(value: unknown): value is LabComponentId {
    return typeof value === "string" && labComponents.some((component) => component.id === value);
}

export function isLabViewportId(value: unknown): value is LabViewportId {
    return typeof value === "string" && labViewports.some((viewport) => viewport.id === value);
}

export function getLabComponent(id: LabComponentId): LabComponentDefinition {
    return labComponents.find((component) => component.id === id) ?? labComponents[0]!;
}
