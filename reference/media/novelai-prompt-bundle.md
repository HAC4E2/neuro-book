# NovelAI 提示词替换、凭据与最终 Prompt Bundle 合同

## 模型与采样参数

- 仅支持 `nai-diffusion-4-5-full` 与 `nai-diffusion-4-5-curated`。
- 旧 Full 类模型规范化到 V4.5 Full，Curated 类规范化到 V4.5 Curated，无法分类回退 V4.5 Full。
- `smea`、`smeaDyn`、`sm`、`sm_dyn` 已从 DTO、Recipe、队列与 payload 删除。
- `decrisp` 保留，并只映射为 V4.5 payload 的 `dynamic_thresholding`；不再发送非标准 `decrisp` 键。

## 提示词替换规则

每行一条 `触发词=动作|插入词`。合法动作：

- `前置前`、`前置后`、`替换`、`替换分角色`、`后置前`、`后置后`、`最后置`
- `替换|` 允许空插入词，表示删除命中文本。
- 多触发词用 `|` 表示任一命中；`@if(...)` 作为扩展语法保留。
- 非空行缺少 `=`、缺少动作分隔符、触发词为空、动作未知或 `@if` 非法都产生带行号错误，不得静默忽略。
- 触发与替换比较使用 Unicode NFKC + 不区分大小写；五种插入动作分别进入命名段，`替换` 只改正文段，`替换分角色` 逐角色正向槽执行且无角色槽时为 no-op。
- 规则是 Provider 级全局设置。`promptReplaceText` 只存在于 Provider 根设置；Recipe、单项画风串导入导出不得包含该字段。内置八行模板唯一常量是 `DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT`。

最终正向逻辑段顺序：

```text
前置前 → 固定正面词（前） → 前置后 → 正文 → 后置前 → 固定正面词（后） → 后置后 → AQT → 最后置
```

## 最终 Prompt Bundle

`buildFinalNovelAiPromptBundle()` 是唯一组装器，输出 `FinalNovelAiPromptBundle`：

```ts
type FinalNovelAiPromptBundle = {
    version: 1;
    modelFamily: "nai4";
    basePositive: string;
    baseNegative: string;
    characters: Array<{positive: string; negative: string; centerX?: number; centerY?: number}>;
    actualInput: string;
    actualNegativeInput: string;
    appliedRuleLines: number[];
};
```

- `actualInput` 与生成器 payload 的 `v4_prompt.caption.base_caption` 一致；`actualNegativeInput` 与 `v4_negative_prompt.caption.base_caption` 一致。
- 基础正向、基础负向与每个角色槽分别去重，正负向永不跨集合去重。
- 去重使用 NFKC + 不区分大小写；`{tag}`、`[tag]`、`tag:1.2`、`1.2::tag::` 归为同一基础 Tag；加权版本优先，多个加权版本按输入顺序取最后一个。
- 新资产保存 `finalPromptBundleJson`；重绘、Tag 修改和局部重绘复用 bundle 的角色槽与坐标，不再重复执行规则或拼接固定词/质量词。

## 正文角色调用与 LLM 格式门禁

正文 L1 `<image>` 块中的角色调用使用成对分隔符 `${...}$`。`illustration.director` 在 L1 进入正文占位符前负责确定性规范化：只有完整 JSON 对象缺少结尾 `$` 且对象通过当前调用字段校验、结尾位于字符串结尾/空白/逗号/XML 标签边界时，才允许补齐；截断 JSON、缺字段、非法身体状态或无法确定边界的内容必须重试，不得猜测。

角色调用字段合同为 `name`、可选非空字符串 `angle`、`upperBody`、`lowerBody`，身体状态沿用 `sfw`、`nsfw`、`hidden`（独立服装调用使用 `visible` / `hidden`）。新输出推荐增加 `kind: "character" | "outfit"`；已落盘的无 `kind` 调用由编译器在当前有效 visual 中精确判定：命中角色名/触发词的是角色，命中服装中英文名的是独立服装，两者同时命中报歧义。`angle` 原文保留为构图 Tag；`from behind`、`from back`、`back`、`behind` 选择背面视觉资料，其余非空角度（包括 `from side`、`side view`、`three-quarter view`）选择正面视觉资料。

独立服装调用不应把服装名当作角色名查找；无 `angle` 的服装优先继承同一 `prompt` 中前一个角色的正/背朝向，没有前序角色时使用正面素材并产生 warning。角色调用中的旧式 `outfit` 字段仍从同一 visual 解析并附加服装 Tag。

L2 只保存规范闭合的调用。写入正文和进入 NovelAI 队列前都必须通过同一角色调用 codec 的严格扫描与 schema 校验；编译器不再修复缺少的 `$`，队列请求不得残留 `${`、`}$` 或未展开调用对象。

## AQT/UCP 单一所有权

AQT/UCP 由本地组装器展开进最终正/负向字符串，出站 payload 固定：

```ts
qualityToggle: false;
ucPreset: resolveNovelAiUcPreset(model, "none");
```

禁止本地拼接同一套质量词的同时再打开服务端自动追加。

## API Key 凭据合同

- Provider DTO 只暴露 `hasCredential` 与 `credentialRevision`，永不回传明文或密文。
- 保存请求使用 `credentialUpdate` 三态：`preserve` / `replace` / `delete`；空字符串不再承担隐式含义。
- 新建 Provider 必须 `replace`；遮罩哨兵（如 `········`）被拒绝。
- `delete` 只清空凭据材料并递增 revision，Provider、画风串和模型参数全部保留。
- 队列消费时比较 Job 的 `providerCredentialRevision` 与当前 Provider revision；不同或已删除时任务稳定失败，不换用新 Key。
- 前端状态只有 `unconfigured` / `saved` / `replacing` / `saving` / `deleting`；已保存显示固定 `········`，不可编辑、不可复制，无明文开关。
