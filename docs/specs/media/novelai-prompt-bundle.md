---
schema: nbook.spec/v1
kind: architecture
status: implemented
capability: media.text-to-image
owners:
  - media
  - server
---

# NovelAI 提示词替换、凭据与最终 Prompt Bundle 合同

## 模型与采样参数

- 支持 `nai-diffusion-5-full`、`nai-diffusion-5-curated`、`nai-diffusion-4-5-full` 与 `nai-diffusion-4-5-curated`；其它模型必须在进入能力表前完成旧值规范化，否则拒绝生成。
- V5 使用 `params_version: 4`，默认 `k_euler_ancestral + native`；V4.5 使用 `params_version: 3`，默认 `k_euler + karras`。保存或切换画风串只修正当前模型不支持的 sampler/noise schedule，不覆盖合法的 Guidance、Steps 等调优值。
- V5 支持 Variety 并使用 v4 sigma 族；首发不支持 Vibe Transfer 和角色参考图。已有配置可以保留，但启用不支持的引用能力时必须在编码或生图网络请求前明确失败。
- V5 Full 局部重绘使用 `nai-diffusion-5-full-inpainting`；V5 Curated 使用 `nai-diffusion-4-5-curated-inpainting`；V4.5 使用各自对应的 inpainting 模型。
- `smea`、`smeaDyn`、`sm`、`sm_dyn` 已从 DTO、Recipe、队列与 payload 删除。
- `decrisp` 保留；请求字段由模型能力和 payload 组装器决定，不发送非标准 `decrisp` 键。

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

`buildFinalNovelAiPromptBundle()` 是唯一组装器。新生成记录写入 v2；历史 v1 只读解析，不批量改写数据库：

```ts
type FinalNovelAiPromptBundleV2 = {
    version: 2;
    modelFamily: "nai45" | "nai5";
    model: "nai-diffusion-5-full" | "nai-diffusion-5-curated"
        | "nai-diffusion-4-5-full" | "nai-diffusion-4-5-curated";
    basePositive: string;
    baseNegative: string;
    characters: Array<{positive: string; negative: string; centerX?: number; centerY?: number}>;
    actualInput: string;
    actualNegativeInput: string;
    appliedRuleLines: number[];
};

type FinalNovelAiPromptBundleV1 = {
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
- 新资产保存 v2 `finalPromptBundleJson`，包含真实模型和模型族。局部重绘保留历史模型、参数、角色槽与坐标语义；历史 v1 bundle 继续可读。

## 当前配置重 roll 与 Tag 发送

- 重 roll 和 Tag 修改后发送只继承源 Job 的基础正向 Prompt、负向 Prompt、角色槽和正文血缘；模型、画风串、参数、Provider 与凭据 revision 使用点击时当前已保存配置，不重放历史最终 Prompt 或历史 Provider 快照。
- 当前活动画风串必须先通过窄作用域保存入口持久化；未保存的其它表单草稿不得进入请求。
- 新任务使用 `seed: -1` 表示队列内部随机种子。消费者在出站前只解析一次为 `0`–`4294967295` 的整数，NovelAI payload 与资产记录使用同一个实际 Seed；负数不得出站。
- 后处理等待队列后先投射 Job 真实终态：`failed` 返回队列错误，`canceled` 返回取消错误，只有 `succeeded` 后仍找不到资产时才报告资产一致性错误。

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

V5 与 V4.5 分别使用各自的本地 UCP 表和 `ucPreset` 映射；V5 的正向 AQT 当前为空。未知质量预设不得臆造 NovelAI 官方参数。

## API Key 凭据合同

- Provider DTO 只暴露 `hasCredential` 与 `credentialRevision`，永不回传明文或密文。
- 保存请求使用 `credentialUpdate` 三态：`preserve` / `replace` / `delete`；空字符串不再承担隐式含义。
- 新建 Provider 必须 `replace`；遮罩哨兵（如 `········`）被拒绝。
- `delete` 只清空凭据材料并递增 revision，Provider、画风串和模型参数全部保留。
- 队列消费时比较 Job 的 `providerCredentialRevision` 与当前 Provider revision；不同或已删除时任务稳定失败，不换用新 Key。
- 前端状态只有 `unconfigured` / `saved` / `replacing` / `saving` / `deleting`；已保存显示固定 `········`，不可编辑、不可复制，无明文开关。
