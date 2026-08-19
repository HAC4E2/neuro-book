import {nbColorwayVarKeys} from "../../../src/colorway/colorway-contract";
import {getInstalledThemes} from "../../../src/theme/theme-loader";
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

export type LabComponentId =
    | "form-input" | "form-number-input" | "form-select" | "form-checkbox" | "time-picker"
    | "button" | "icon-button" | "segmented-control" | "switch-field" | "dropdown" | "tabs"
    | "badge" | "spinner"
    | "pagination";
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
    /** 切换场景时恢复到的默认值；缺省按类型推导（boolean→false、text→""、select→首项） */
    defaultValue?: string | boolean;
};

export type LabScene = {
    id: string;
    label: string;
    /** 场景语义是结构化的：检查器据此断言 aria-invalid，不再靠场景 id 字符串匹配 */
    invalid?: boolean;
    disabled?: boolean;
};

export type LabComponentDefinition = {
    id: LabComponentId;
    label: string;
    /** 中文名，导航里作主名，英文组件名作副名 */
    labelZh: string;
    group: string;
    description: string;
    scenes: LabScene[];
    controls: LabPropControl[];
    /** 检查器读取的真实目标元素选择器 */
    targetSelector: string;
    /** 用户可观察事件名单；事件日志只记录名单内的事件 */
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
        labelZh: "输入框",
        group: "表单",
        description: "文本、搜索、密码与数字字符串输入；支持前缀、只读和字段错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "prefix", label: "前缀"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "type", label: "类型", type: "select", defaultValue: "text", options: [
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
        labelZh: "数字输入",
        group: "表单",
        description: "保留编辑中间态的数字字符串输入；支持步进、边界和 Enter 提交。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "bounded", label: "边界"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "readonly", label: "只读", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "default", options: sizeOptions},
            {id: "step", label: "步进", type: "text", defaultValue: "0.5"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "submit"],
    },
    {
        id: "form-select",
        label: "FormSelect",
        labelZh: "选择器",
        group: "表单",
        description: "Reka Select 选择器；支持说明、图标、方向、紧凑尺寸与禁用项。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "rich", label: "丰富选项"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "hideCheckmark", label: "隐藏勾选", type: "boolean"},
            {id: "size", label: "尺寸", type: "select", defaultValue: "default", options: sizeOptions},
            {id: "direction", label: "展开方向", type: "select", defaultValue: "auto", options: directionOptions},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "form-checkbox",
        label: "FormCheckbox",
        labelZh: "复选框",
        group: "表单",
        description: "布尔字段；支持可选文字、true/false 回退、禁用和错误语义。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "fallback", label: "值回退"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "disabled", label: "禁用", type: "boolean"},
            {id: "label", label: "标签", type: "text", defaultValue: "启用同步"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue", "focus"],
    },
    {
        id: "time-picker",
        label: "TimePicker",
        labelZh: "时间选择",
        group: "表单",
        description: "第一个允许主题覆盖实现的组件：默认是输入框+时间列表，macOS 主题是滚轮，v-model 契约一致。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "invalid", label: "错误", invalid: true},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "step", label: "步进（分）", type: "text", defaultValue: "30"},
            {id: "min", label: "下限", type: "text", defaultValue: "08:00"},
            {id: "max", label: "上限", type: "text", defaultValue: "20:00"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "button",
        label: "Button",
        labelZh: "按钮",
        group: "控件",
        description: "五种变体两档尺寸；loading 场景锁定交互并给出忙碌指示。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "loading", label: "加载"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "variant", label: "变体", type: "select", defaultValue: "primary", options: [
                {label: "主要", value: "primary"},
                {label: "次要", value: "secondary"},
                {label: "柔和", value: "subtle"},
                {label: "危险", value: "danger"},
                {label: "幽灵", value: "ghost"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
            {id: "block", label: "撑满宽度", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["click"],
    },
    {
        id: "icon-button",
        label: "IconButton",
        labelZh: "图标按钮",
        group: "控件",
        description: "紧凑图标操作；title 即无障碍名称，是检查器的可读名称来源。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "variant", label: "变体", type: "select", defaultValue: "default", options: [
                {label: "默认", value: "default"},
                {label: "强调", value: "accent"},
                {label: "危险", value: "danger"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["click"],
    },
    {
        id: "segmented-control",
        label: "SegmentedControl",
        labelZh: "分段选择",
        group: "控件",
        description: "互斥选项组；lab 页自己的场景/视口切换就是它，禁用项场景展示不可选态。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled-item", label: "禁用项"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "sm", options: [
                {label: "紧凑", value: "sm"},
                {label: "更小", value: "xs"},
            ]},
            {id: "tone", label: "色调", type: "select", defaultValue: "default", options: [
                {label: "默认", value: "default"},
                {label: "强调", value: "accent"},
                {label: "警告", value: "warning"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "switch-field",
        label: "SwitchField",
        labelZh: "开关字段",
        group: "控件",
        description: "role=switch 的布尔字段；aria-checked 是检查器的重点读数。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "disabled", label: "禁用", disabled: true},
        ],
        controls: [
            {id: "description", label: "描述", type: "text", defaultValue: "本地修改实时同步到工作区"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "dropdown",
        label: "Dropdown",
        labelZh: "下拉菜单",
        group: "控件",
        description: "触发器+菜单原语；含子菜单、分隔线与危险项，键盘可全程操作。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "compact", label: "紧凑触发器", type: "boolean"},
        ],
        targetSelector: "#nb-lab-target [aria-haspopup]",
        events: ["select"],
    },
    {
        id: "tabs",
        label: "Tabs",
        labelZh: "页签",
        group: "控件",
        description: "tablist 语义与方向键漫游；禁用项不可聚焦，选中项带计数。",
        scenes: [
            {id: "default", label: "默认"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:modelValue"],
    },
    {
        id: "badge",
        label: "Badge",
        labelZh: "徽章",
        group: "显示",
        description: "状态色三件套（主色/底色/边框）的直接消费方；dot 场景用于「运行中」类状态。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "dot", label: "圆点"},
        ],
        controls: [
            {id: "tone", label: "色调", type: "select", defaultValue: "accent", options: [
                {label: "中性", value: "neutral"},
                {label: "强调", value: "accent"},
                {label: "成功", value: "success"},
                {label: "警告", value: "warning"},
                {label: "危险", value: "danger"},
            ]},
            {id: "variant", label: "变体", type: "select", defaultValue: "soft", options: [
                {label: "柔和", value: "soft"},
                {label: "描边", value: "outline"},
                {label: "实心", value: "solid"},
            ]},
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "默认", value: "md"},
                {label: "紧凑", value: "sm"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "spinner",
        label: "Spinner",
        labelZh: "加载指示",
        group: "显示",
        description: "role=status 的加载指示；label 是无障碍名称，showLabel 场景同时显示文字。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "labeled", label: "带文字"},
        ],
        controls: [
            {id: "size", label: "尺寸", type: "select", defaultValue: "md", options: [
                {label: "紧凑", value: "sm"},
                {label: "默认", value: "md"},
                {label: "大", value: "lg"},
            ]},
        ],
        targetSelector: "#nb-lab-target",
        events: [],
    },
    {
        id: "pagination",
        label: "Pagination",
        labelZh: "分页",
        group: "导航",
        description: "nav 语义 + 页码窗口；边界场景下上一页/下一页按钮自动禁用。",
        scenes: [
            {id: "default", label: "默认"},
            {id: "first", label: "首页边界"},
            {id: "last", label: "末页边界"},
        ],
        controls: [
            {id: "pageCount", label: "总页数", type: "text", defaultValue: "9"},
        ],
        targetSelector: "#nb-lab-target",
        events: ["update:page"],
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

/**
 * 已装主题 manifest.declares 声明的变量，去重并排除核心组已登记的名字。
 * 必须在主题装载完成后调用（页面 setup 时主题已装完），不能放在模块顶层求值。
 */
export function collectDeclaredTokenGroup(): LabTokenGroup | null {
    const registered = new Set(labCoreTokenGroups.flatMap((group) => group.tokens));
    const declared: string[] = [];
    for (const theme of getInstalledThemes()) {
        for (const declaration of theme.manifest.declares ?? []) {
            if (!registered.has(declaration.name) && !declared.includes(declaration.name)) {
                declared.push(declaration.name);
            }
        }
    }
    return declared.length === 0 ? null : {id: "theme-declares", label: "主题 · 声明", tokens: declared};
}

export function isLabComponentId(value: unknown): value is LabComponentId {
    return typeof value === "string" && labComponents.some((component) => component.id === value);
}

export function isLabViewportId(value: unknown): value is LabViewportId {
    return typeof value === "string" && labViewports.some((viewport) => viewport.id === value);
}

export function getLabComponent(id: LabComponentId): LabComponentDefinition {
    return labComponents.find((component) => component.id === id) ?? labComponents[0]!;
}

export function getLabScene(definition: LabComponentDefinition, sceneId: string): LabScene {
    return definition.scenes.find((scene) => scene.id === sceneId) ?? definition.scenes[0]!;
}

/** 控件的默认值：显式 defaultValue 优先，否则按类型推导 */
export function controlDefaultValue(control: LabPropControl): string | boolean {
    if (control.defaultValue !== undefined) return control.defaultValue;
    if (control.type === "boolean") return false;
    if (control.type === "select") return control.options?.[0]?.value ?? "";
    return "";
}
