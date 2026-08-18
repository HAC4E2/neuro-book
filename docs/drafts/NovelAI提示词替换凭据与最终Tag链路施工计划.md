# NovelAI 提示词替换、凭据状态与最终 Tag 链路施工计划

> 状态：已按代码可验证范围施工；真实 NovelAI 请求对照与浏览器人工验收未执行
> 计划日期：2026-08-16
> 性质：独立施工计划；不扩写 Task 142，不替代既有角色管理计划
> 施工动作：已完成第 3 节五项阻断项修复、CredentialUpdate 三态后端与前端、结构化替换规则、最终 Prompt Bundle/去重、V4.5 Full/Curated 收窄、SMEA/SMEA DYN 移除、Decrisp 单一映射、资产最终 bundle 字段与后处理复用；聚焦测试 `72` 个文件、`415/415` 通过，根 `nuxt typecheck` 退出码 0。真实 NovelAI 请求对照、真实 Project 迁移和浏览器人工验收未执行。

## 1. 目标与范围

本计划统一解决以下问题：

1. 补齐 chatu-8 NovelAI 提示词替换的七个动作，并让每种动作落在确定的最终提示词位置；示例中的第八种行为是 `替换|` 空值删除，不是独立动作名；
2. 为替换规则增加语法校验、行号错误、执行预览和“替换分角色”的结构化角色槽支持；
3. 将 NovelAI API Key 从“空输入框代表可能已保存”改为明确的“已保存并使用中 / 未配置 / 正在替换”状态；
4. API Key 保存后只显示不可查看、不可复制的 `········`，永不从后端取回明文；允许显式删除 Key，或输入新 Key 覆盖；
5. 把正文、固定画风串、替换规则、角色槽、AQT/UCP 与最终去重收敛到一个可测试的组装器；
6. 以 NAI4.5 的结构化基础提示词和角色 `char_captions` 为主链，保存真正发送给 NovelAI 的结构化最终快照；
7. 固定“启用角色分组”和“发送数据勾选角色”之间的业务边界；
8. 保留上一轮代码审查发现的全部阻断项，先解决共享事务恢复、跨 Project 保存、等价合并、孤儿文件和离开保护问题，再宣告本计划验收完成。
9. 将模型范围明确收窄为 NovelAI Diffusion V4.5 Full/Curated，删除对 V4.5 请求不生效的 SMEA、SMEA DYN 控件和配置字段，不再施工或验收 NAI3 兼容路径。
10. 把用户给出的八行示例内置为新配置的默认提示词替换规则；字段缺失时补默认值，用户主动清空后保持为空。
11. 将提示词替换规则从画风串 Recipe 中彻底拆出，改为 NovelAI Provider 级全局规则；切换任何画风串都不改变规则，使用该 Provider 的所有生图入口统一生效。

本计划不处理 Nuxt 开发态 `worker entry not found`，不改 LLM Provider 的模型发现/私网代理问题，也不重新设计角色视觉 JSON 的字段含义。

## 2. 诊断结论

### 2.1 NovelAI API Key：安全边界正确，状态表达和删除合同缺失

已验证：

- Provider DTO 只返回 `hasCredential` 和 `credentialRevision`，没有密文或明文；服务端列表接口不会把 Key 回传浏览器；
- 当前 NovelAI 页面每次选择 Provider 都把本地 `credential` 清空，输入框文案为“留空表示保留”；因此用户看不出当前是否真的有 Key 在生效；
- 保存时只有输入非空 Key 才替换旧凭据，编辑站点或画风配置不会清空 Key；
- 当前只有“删除整个 Provider”，没有“保留 Provider 和配置、只删除 Key”的 API 合同；
- 子组件发出保存事件后无法等待父组件保存成功，因而也不能可靠地在成功后清掉内存中的明文草稿或显示精确状态。

结论：不得把旧 Key 回填到输入框，也不得用真实 Key 的长度生成遮罩；应继续保留“后端永不回传 Key”的边界，在前端用 `hasCredential` 驱动固定长度状态占位，并新增显式替换、删除合同。

### 2.2 提示词替换：当前只部分支持，七个动作及空值删除尚未完整对齐

当前 `prompt-replacement.ts` 支持：

- `前置前`、`前置后`、`后置前`、`后置后`、`最后置`；
- `替换`，其中空插入词可以删除命中的文本；
- 多触发词和既有 `@if(...)` 条件。

当前缺口：

- 不支持 `替换分角色`；
- 未知动作、缺少 `=`、缺少动作分隔符等错误会被静默跳过；
- 五种插入动作在运行时被压成一个前缀和一个后缀，无法保证原生语义所要求的具体位置；
- 规则只处理场景 `request.prompt`，不处理结构化 `characterPrompts`；
- 设置页只是普通文本框，没有语法说明、保存校验、行号错误或实际组装结果预览。
- `promptReplaceText` 同时存在于 Provider 根设置和每个画风串 Recipe；切换画风串会把 Recipe 内规则覆盖到根表单，保存画风串又会把当前规则复制回 Recipe，因此它目前不是全局规则；
- 当前默认是空字符串，没有项目内置示例；新 Provider 和缺字段旧配置不会自动获得规则模板。

### 2.3 最终 Tag 组装与去重：基础路径有效，但不能判定为完整正常

已验证正常的部分：

- 队列会在固定正向词、正文主提示词、固定后置词和 AQT 合并后，对基础正向提示词去重；
- 队列会在 UCP 与负向提示词合并后，对基础负向提示词去重；
- NAI4/4.5 的每个角色正向、负向槽会分别去重，并以结构化 `char_captions` 发送；
- `useFinalPrompt` 路径仍会去重，但会跳过固定词和质量词的二次拼接；
- 当前去重能识别普通 Tag、`tag:1.2`、`1.2::tag::`、花括号/方括号和大小写重复；存在加权项时优先保留加权写法。

已确认的缺口：

1. NAI4/4.5 资产没有保存角色 `char_captions`；历史重绘和 Tag 修改只复用基础 `prompt/negativePrompt`，无法精确复现原请求。
2. 规则替换发生在最终组装之前，但五种插入位置已被压平，因此“去重执行了”不等于“最终顺序正确”。
3. 当前同时手工拼接 AQT/UCP 文本，并向 NovelAI payload 传递 `qualityToggle/ucPreset`。本地代码和现有测试不能证明服务端是否会再次追加同一套质量词；在完成真实 payload 对照前，此处必须标为未验证的重复注入风险。
4. `credentialRevision` 已记录在 Job 中，但消费队列只按 Provider ID 读取当前 Key，没有比较 revision。排队后替换 Key 可能让旧任务静默使用新 Key；删除 Key则让旧任务在消费时失败。

因此，“最后发送 NovelAI 请求时 Tag 组装和重复清理是否正常”的准确结论是：基础正负向和 NAI4.5 单槽去重正常；但 NAI4.5 历史请求复现、质量预设单一所有权和 Key revision 校验不完整，整体仍不能验收为正常。本计划不再把 NAI3 纳入实现或验收范围。

### 2.4 SMEA/SMEA DYN：官方仍保留通用参数，但当前 V4.5 分支实际不发送

核对结果：

- NovelAI 官方采样文档仍把 SMEA 和 SMEA DYN 描述为特殊采样方式，官方图片 API OpenAPI 的通用请求参数也仍包含 `sm`、`sm_dyn`；官方材料没有把它们明确标成“仅 NAI3”；
- 但当前项目的 `novelai-image-generation.ts` 只在非 V4 分支写入 `parameters.sm` 和 `parameters.sm_dyn`；进入 V4/V4.5 分支时两个字段不会出现在真实请求；
- 前端和 Recipe 仍允许保存 `smea/smeaDyn`，默认值甚至都是 `true`，因此用户看到的是两个对 V4.5 没有实际作用的开关。

产品已经确定只使用 NAI4.5，所以本计划不继续研究如何把 SMEA 接入 V4.5，也不保留无效配置。施工时删除 UI、DTO、Recipe、normalizer、队列输入和生成器输入中的 `smea/smeaDyn`，并用出站 payload 测试证明 V4.5 请求不再出现 `sm/sm_dyn`。

### 2.5 Decrisp：对 NAI4.5 有效，应保留

核对结果：

- NovelAI 官方当前把 Decrisper 描述为缓解较高 Prompt Guidance 下颜色和视觉伪影的功能，并说明 V3 及更高模型可使用相关 Guidance 功能；没有把它限制在 NAI3；
- 当前项目把 `decrisp` 映射为所有模型请求的 `dynamic_thresholding`，V4.5 分支不会跳过该字段；但 payload 还额外发送了官方 OpenAPI 未列出的同名 `decrisp` 字段，应清理这个冗余字段；
- 因此它和当前实际无效的 SMEA/SMEA DYN 不同，必须继续保留。

施工时为 V4.5 Full/Curated 分别增加 `decrisp=true/false` 的出站 payload 测试，断言 `dynamic_thresholding` 与界面开关一致，并断言不再发送非标准 `decrisp` 键；设置页辅助文案改为“缓解高 Guidance 下的颜色和视觉伪影”，不能将其误写成锐化或高清修复。

### 2.6 角色识别：启用分组是自动扫描，发送数据是无条件固定发送

固定业务结论如下：

- “当前启用角色分组”决定正文自动扫描的候选视觉资料；
- “发送数据”中勾选角色，表示无条件固定发送，不依赖正文是否出现触发词；
- 角色未在“发送数据”勾选，但所在分组已启用时，只有正文命中该角色的显式 `|` 触发词才会注入；显式触发词为空时，运行时临时回退中英文名；
- 正文没有命中时不会注入，因此“启用分组”不等于“始终发送该分组所有角色”；
- 同一角色同时被自动扫描和固定发送命中时，固定发送项覆盖自动扫描项；
- 多个已启用分组存在同一 `characterId` 时，按分组优先级取第一个生效视觉，不能把同一逻辑角色重复发送。

前端必须把上述两种行为写在页面说明和预览中，不能只用“启用”一词让用户猜测。

## 3. 施工前必须保留并解决的审查阻断项

以下问题来自上一轮落地结果审查，本计划不得删除、弱化或用新增功能掩盖。它们应作为 Phase 0 先修项；未完成时不能宣告本计划整体完成。

### 3.1 P1：共享 `.txn` 恢复器会误处理其它事务日志

`CharacterVisualLibraryService.ensure()` 在未获取 Project 写锁时依次调用四套恢复器。`recoverUnfinishedGroupMigrations()` 会扫描共享 `.txn` 下所有 `.json`，但分组迁移日志没有 `kind`，恢复时也没有按 `kind` 分流。视觉移动、身份更新和触发词迁移都使用同一目录并带自己的 `kind`。

坏结果：分组恢复器可能把其它事务的日志当作分组迁移，访问不存在字段、删除仍在使用的日志或备份，并与另一个并发 `ensure()`/写事务相互干扰。

修复要求：

- 建立唯一事务日志 envelope：`{kind, version, transactionId, state, createdAt, payload}`；
- 由一个恢复调度器校验 envelope 后按 `kind` 分派，业务恢复器不得自行扫描全部日志；
- 给分组迁移补 `kind` 和版本；未知 kind、损坏日志只报告并保留，不得删除；
- 恢复、迁移和视觉库写入使用同一 Project 级排他锁；
- 区分仍在活跃的事务与超过阈值的中断事务，不得看到日志就回滚；
- 增加四类事务并存、活跃事务、损坏日志、未知版本、恢复进程中再次崩溃的测试。

### 3.2 P1：切换 Project 后可能把旧 Project 内存状态写入新 Project

角色管理和发送数据页面都在监听 `projectRoot` 后询问保存/放弃，但保存函数直接使用已经变化的 `props.projectRoot`。用户取消切换后，旧页面状态仍可能在下一次保存时写入新 Project。

修复要求：

- 组件持有 `loadedProjectRoot`，所有读写都绑定加载该状态时的根；
- 父级在提交新 Project 之前完成离开保护，取消时不得让 prop 先变化；
- `loadedProjectRoot !== props.projectRoot` 时禁止保存并要求重新加载；
- 迟到响应必须带 request token，只能更新对应 Project；
- 增加“有未保存修改 → 外部切换 → 取消 → 再保存”的双组件测试，断言旧数据不进入新 Project。

### 3.3 P1：等价合并返回“已生效”，但目标 manifest 未切换生效项

视觉移动遇到目标已有等价内容时会跳过目标 manifest 更新，却返回该目标 ref 已生效。若目标原本生效的是另一视觉，UI 与磁盘状态不一致。

修复要求：等价合并也必须把目标 `activeVisualId` 更新为复用的等价视觉，并在事务复读中验证；增加“目标另有生效视觉 + 等价视觉原本未生效”的测试。

### 3.4 P2：多版本角色移动后可能留下来源孤儿 JSON

来源角色仍有其它视觉版本时，移动事务会从 manifest 过滤当前视觉，但没有删除当前来源物理 JSON；验证只检查 manifest，无法发现目录中的孤儿文件。

修复要求：事务备份后删除精确来源文件，验证 manifest 不再引用且原路径不存在；失败回滚必须恢复同字节文件。增加正常移动、故障注入和重启恢复测试。

### 3.5 P2：离开保护在异步保存完成前提前清除

统一 leave guard 在执行保存回调前先清空 pending guard；角色保存若又进入身份同步确认，会打开第二层对话框并返回 false，原始“关闭/切页/切 Project”动作不会在确认后继续。

修复要求：用可恢复 continuation/state machine 保存原始动作；多阶段确认全部成功后只继续一次，失败或取消继续保持 dirty 与离开保护。增加身份修改后关闭、切页和切 Project 三条测试。

### 3.6 P3：验证数字文档不一致

Task 142 记录为 `67` 个测试文件、`380/380` 通过；`PROJECT-STATUS.md` 仍写 `56` 个文件、`347/347` 通过。完成施工后必须以一次独立重跑的实际输出统一两处数字，不得保留冲突记录。

## 4. 固定产品与安全合同

### 4.1 API Key 三态合同

Provider 保存请求不再用“空字符串的隐式含义”承担全部行为，改为显式联合类型：

```ts
type CredentialUpdate =
    | {mode: "preserve"}
    | {mode: "replace"; value: string}
    | {mode: "delete"};
```

规则：

- `preserve`：编辑站点、画风串或模型参数时保持现有 Key，不改变 revision；
- `replace`：只接受非空真实 Key，加密保存；真实值变化时 revision 加一；
- `delete`：只清除密文、IV 和认证 Tag，保留 Provider 与所有非敏感配置，revision 加一；
- 新建 Provider 必须使用 `replace`，没有 Key 不允许创建成“看似可用”的 Provider；
- 后端拒绝 `········`、星号或其它遮罩哨兵作为 Key；遮罩从不进入请求 DTO；
- Provider DTO 继续只暴露 `hasCredential/credentialRevision`；不存在读取明文、复制 Key 或切换明文显示的 API；
- 删除 Key 前使用确认 Dialog，说明排队任务和新请求将不能使用该 Provider；
- 队列消费时比较 Job 保存的 revision 与当前 revision。不同或 Key 已删除时，任务以稳定错误失败并提示重新提交，不得静默换用另一 Key/账号。

### 4.2 API Key 前端状态机

界面状态固定为：

1. `unconfigured`：显示“未配置 API Key”和“添加 Key”；
2. `saved`：显示不可编辑、不可选中、`aria-label="API Key 已保存并使用中"` 的固定 `········`，同时显示“已保存并使用中”；
3. `replacing`：显示空的 password 输入框、保存新 Key和取消按钮；输入时以 `·` 视觉遮蔽，不提供显示明文开关；
4. `saving/deleting`：显示专属 spinner，锁定重复操作；
5. `error`：保留可恢复操作和局部错误，不把 Key 写入通知、日志或错误对象。

实现约束：

- 已保存状态使用普通不可选中状态块，不把 `········` 填进 input；
- 替换输入使用 `type="password"`、`autocomplete="new-password"`、`spellcheck="false"`，阻止 copy/cut，允许用户粘贴新 Key；
- Vue ref 只暂存本次输入的明文；保存成功、取消、切 Provider、关闭工作台和组件卸载时立即清空；
- 保存失败可保留当前输入用于重试，但不得写入全局 store、URL、localStorage、sessionStorage、序列化快照或调试工具；
- 子组件必须 await 保存结果。只有服务端成功并重新取得 `hasCredential=true` 后，才能清空输入并切到 `saved`；
- 其它设置的自动保存永远使用 `preserve`，不得携带本地 Key 草稿；替换 Key 必须是独立显式动作。

### 4.3 提示词替换语法

每行一条：

```text
触发词=动作|插入词
```

合法动作只有：

- `前置前`
- `前置后`
- `替换`
- `替换分角色`
- `后置前`
- `后置后`
- `最后置`

其中 `替换|` 的插入词允许为空，表示删除触发词。空行允许；非空行缺少 `=`、缺少动作分隔符、触发词为空或动作未知都必须返回带行号的校验错误，不能静默忽略。既有 `@if(...)` 作为扩展语法保留，并纳入同一解析器与错误定位。

项目内置默认值必须逐字保持为：

```text
触发词1=前置前|插入词1
触发词2=前置后|插入词2
触发词3=替换|替换词3
触发词4=替换|
触发词5=替换分角色|替换词5
触发词6=后置前|插入词6
触发词7=后置后|插入词7
触发词8=最后置|插入词8
```

默认值合同：

- 建立唯一常量 `DEFAULT_NOVEL_AI_PROMPT_REPLACE_TEXT`，Provider 全局设置 schema、初始表单和测试只能引用该常量，不允许复制多份字符串；
- 新建 NovelAI Provider，以及导入时 Provider 全局字段缺少 `promptReplaceText` 的配置使用上述默认值；新建画风串不得保存或复制该默认值；
- 已存在且明确保存为全局 `promptReplaceText: ""` 表示用户主动关闭全部替换规则，必须保持为空，不能在加载、切换画风串或保存时重新补回；
- 导入时字段缺失和字段存在但为空必须区分；非字符串或非法规则返回校验错误，不能回退默认值掩盖损坏配置；
- “恢复内置示例”作为独立按钮，点击后先预览影响，有未保存规则时要求确认；不能靠每次初始化强制覆盖；
- 内置示例使用占位触发词，默认不会修改普通提示词；它的目的同时是可编辑模板和七个动作/空值删除的语法说明。

### 4.3.1 全局规则所有权

“全局”固定指当前 NovelAI Provider 的全局设置，而不是某个 Project、画风串或单次 Job 的可编辑字段。若未来允许多个 NovelAI Provider，每个 Provider 各自持有一份全局规则，互不覆盖。

数据合同：

- `TextToImageNovelAiSettingsSchema.promptReplaceText` 保留，并使用内置八行模板作为字段缺失时的默认值；
- 从 `TextToImageNovelAiGenerationRecipeSchema` 删除 `promptReplaceText`；Recipe 导入、导出、另存为、复制、重命名和分组都不能出现该字段；
- `resolveNovelAiGenerationSettings()` 应用 Recipe 时必须显式保留 Provider 根设置的 `promptReplaceText`，不能由对象展开顺序偶然决定；
- 切换、创建、删除或重命名画风串只改变画风和模型参数，不读取、不覆盖、不保存全局规则；
- 全局规则使用独立“保存全局规则”动作，不能复用“保存画风串和模型参数”按钮；
- Provider 全量导入/导出包含一份全局规则；单个画风串导入/导出完全不包含规则；
- 手动生图、正文生图、角色首份设计/修改预览后的角色照片、历史重绘、Tag 修改和局部重绘，只要使用该 Provider，都消费同一全局规则；
- 已经保存为最终 prompt bundle 的历史重绘不重复执行规则；新的源提示词请求在入队时冻结全局规则文本、解析版本和内容哈希，排队期间修改全局规则不追改已排队 Job；
- 规则预览明确显示“全局生效”，并列出它将覆盖的入口，不能让用户误以为只影响当前画风串。

旧配置迁移合同：

1. 在原始 JSON 进入带默认值的 Zod parse 前判断根字段是否真实存在，避免把“缺失”误判为显式空字符串；
2. 根 `promptReplaceText` 存在且为字符串时，它是当前全局真相源，包括显式空字符串；
3. 根字段缺失时，优先取当前启用 Recipe 的旧 `promptReplaceText`；没有当前项时按 Recipe 稳定 ID 顺序取第一个合法值；所有 Recipe 都缺失时使用八行内置默认；
4. 根字段和 Recipe 存在不同值时，保留根字段作为全局规则，并在首次迁移摘要中说明“原画风串内规则已统一为当前全局规则”；不得静默拼接多套规则；
5. 迁移保存时从全部 Recipe 删除 `promptReplaceText`，复读确认全局字段仅存在一份；
6. 非法值或非法规则中止迁移并带路径/行号报错，不能为了完成迁移丢掉规则；
7. 历史 Job/资产快照只读，不追溯改写。

多触发词继续使用 `|` 表示“任一命中”。正式施工前用 chatu-8 原预设建立 golden fixtures，冻结以下细节：大小写、Unicode NFKC、同一行多触发词同时出现、同一 Tag 被多行规则命中、规则是否级联、替换范围和空白处理。没有 golden 证据时不得靠实现者猜测改变兼容语义。

### 4.4 七个动作及空值删除的确定位置

最终正向提示词的逻辑段顺序固定为：

```text
前置前
→ 固定正面词（前）
→ 前置后
→ 正文/场景提示词
→ 后置前
→ 固定正面词（后）
→ 后置后
→ AQT
→ 最后置
```

动作合同：

- `替换` 只替换场景/正文正向段中的触发词，不改固定词、AQT 或角色槽；
- `替换分角色` 对每一个结构化角色正向槽分别执行，只修改命中的角色槽；没有角色槽时是可预览的 no-op，不得退化为全局替换；
- 五种插入动作命中后进入对应命名段，不能再压成统一 prefix/suffix；
- 条件判断和触发判断基于施工时冻结的原始输入快照，避免插入结果意外触发后续规则；若 chatu-8 golden 证明为顺序级联，则以 golden 为准并明确记录；
- 历史 `useFinalPrompt`/最终快照路径不再执行规则替换，避免二次修改。

### 4.5 最终 Tag 去重合同

建立唯一 `buildFinalNovelAiPromptBundle()`，输出至少包含：

```ts
type FinalNovelAiPromptBundle = {
    version: 1;
    modelFamily: "nai4";
    basePositive: string;
    baseNegative: string;
    characters: Array<{
        positive: string;
        negative: string;
        centerX?: number;
        centerY?: number;
    }>;
    actualInput: string;
    actualNegativeInput: string;
    appliedRuleLines: number[];
};
```

去重规则：

- 正向、负向永远分开去重；
- NAI4/4.5：基础正向、基础负向和每个角色槽分别去重，保持结构化边界；最终 bundle 与 `v4_prompt/v4_negative_prompt` 一一映射；
- 非 V4.5 模型不进入新的组装器合同，也不保留专用运行分支；
- 去重在全部固定词、替换规则、角色展开、福瑞前缀和质量词处理完成后执行；
- 空 Tag 清理，Unicode NFKC + 不区分大小写比较；
- `{tag}`、`[tag]`、`tag:1.2`、`1.2::tag::` 归为同一基础 Tag；
- 同一基础 Tag 有加权和无权重版本时保留加权版本；多个加权版本按 golden fixture 冻结确定规则，不能由遍历偶然顺序决定；
- 保持首个基础 Tag 的槽位顺序，替换内容不应让其它 Tag 重排；
- 解析器必须为 NovelAI 权重、转义逗号或其它不可拆结构补 fixtures，不能只用裸 `split(",")` 假定所有逗号都是分隔符。

### 4.6 AQT/UCP 单一所有权

当前“手工拼文本 + 同时传 `qualityToggle/ucPreset`”不能继续作为未验证状态。施工时必须先捕获并比较：

- chatu-8 对同模型/同预设产生的最终请求；
- 当前应用在开启/关闭 AQT、UCP 时的出站 JSON；
- NovelAI 返回图片元数据中记录的最终 prompt（使用测试凭据时只记录脱敏结构和测试 Tag）。

然后只保留一个所有者：要么由本地组装器展开质量词并关闭服务端自动追加，要么只传开关/预设值而不把同一套词手工拼进字符串。正向和负向必须各自只有一个所有者。该决策写入 reference 和 payload 单元测试后才能实现，禁止在没有证据时双写或删除任一侧。

### 4.7 最终快照与历史操作

- Job 保存输入快照；资产另存版本化 `FinalNovelAiPromptBundle`，其 `actualInput/actualNegativeInput` 必须与真正发出的 payload 一致；
- NAI4/4.5 必须保存角色 captions 和坐标，不能只保存基础 prompt；
- 重绘保留全部结构化角色槽并换 seed；Tag 修改明确编辑基础正向段，未修改的角色槽继续保留；
- 历史没有 bundle 的资产走只读兼容：标记“旧记录只保存基础提示词，无法完整复现角色槽”，不得伪造缺失内容；
- 新资产不得继续依赖 `useFinalPrompt: true + 两个字符串` 表示全部最终请求。

### 4.8 仅支持 NAI4.5 的模型和参数合同

- 前端模型选择只保留 `nai-diffusion-4-5-full` 与 `nai-diffusion-4-5-curated`；
- 新建、保存、导入 Recipe 和创建 Job 时，后端都只接受上述两个模型，不能只在前端隐藏旧模型；
- 删除 NAI3/V4.0 专用 payload 分支、模型族压平逻辑和相关类型，不为旧模型增加兼容代码；
- 删除 `smea/smeaDyn`、`sm/sm_dyn` 的 UI、DTO、Recipe 字段、默认值、归一化、队列转发、生成器入参和测试 fixtures；
- 保留配置字段 `decrisp`，只映射到 V4.5 请求的官方 `dynamic_thresholding`；移除 payload 中冗余的 `decrisp` 键，Full/Curated 行为必须由测试覆盖；
- 旧配置中的 `smea/smeaDyn` 在下一次规范化保存时被丢弃，不生成隐藏的无效字段；
- 旧 Recipe 若使用 Full 类旧模型，规范化到 V4.5 Full；若使用 Curated 类旧模型，规范化到 V4.5 Curated；无法分类的旧模型回退 V4.5 Full，并在首次加载时显示一次升级说明；
- 模型升级只改模型标识并清理无效字段，不擅自改用户画风串、固定提示词、替换规则、尺寸、采样器或 seed；
- 历史 Job 和历史资产保持只读，不追溯改写；重新发送时必须生成新的 V4.5 Job 快照。

## 5. 分阶段施工计划

### Phase 0：修复审查阻断项

按第 3 节顺序完成统一事务恢复与锁、Project 切换绑定、等价合并生效项、来源孤儿文件和多阶段 leave guard。先写能在当前代码稳定失败的测试，再修业务代码。

退出条件：五项行为测试和恢复故障注入全部通过；Task/Project Status 测试数字以同一次重跑结果统一。

### Phase 1：冻结规则与出站合同

- 从用户给出的 chatu-8 预设建立去敏 golden fixtures；
- 将八行内置规则抽成唯一默认常量，为“字段缺失”“显式空字符串”“恢复内置示例”建立 fixtures；
- 为根规则与 Recipe 规则相同、不同、缺失、显式空和非法值建立迁移 fixtures；
- 为七个动作、`替换|` 空值删除、`@if`、多触发词、错误行和多角色槽写失败测试；
- 对 NAI4.5 建立“逻辑段 → `v4_prompt/v4_negative_prompt`”快照测试；
- 为旧模型 Recipe 到 V4.5 Full/Curated 的规范化和 `smea/smeaDyn` 清理建立 fixtures；
- 对 AQT/UCP 做本地出站捕获；真实 NovelAI 对照仅在用户提供测试凭据并授权后执行；
- 将最终段顺序、规则级联与加权冲突策略写入稳定 reference。

退出条件：所有未决行为都有 golden 证据或被明确标为需要用户验收，不允许隐藏在实现默认值中。

### Phase 2：API Key 合同与后端

- 在共享 DTO/Zod schema 中加入严格 `CredentialUpdate`；
- 改造 Provider service 的 preserve/replace/delete 分支和 revision；
- 数据库若凭据列当前不可空，做明确 schema 迁移，使无 Key Provider 合法但 `hasCredential=false`；不得用伪密文占位；
- 增加只删除 Key 的 PUT/专用动作，不复用删除 Provider 路由；
- 队列运行时校验 revision 和 `hasCredential`；
- 统一错误投影，任何路径不输出 Key、密文材料或 Authorization。

退出条件：创建、保留、同值替换、异值替换、删除、并发旧 revision 和解密失败测试全部通过。

### Phase 3：API Key 前端状态机

- 用 `hasCredential` 渲染未配置/已保存状态；
- 已保存状态显示 `········`、状态文案、替换和删除按钮；
- 替换操作打开独立 password 输入，不与站点/画风自动保存共用；
- 父组件保存返回可 await 的成功 DTO，子组件只在确认成功后清明文；
- 删除使用通用 `Dialog`，保存/删除使用 `useNotification()` 和动作专属 pending；
- 关闭、切换、取消和卸载清理内存草稿。

退出条件：用户始终能判断是否有 Key 在被使用，同时任何页面状态都不能再次显示或复制旧明文。

### Phase 4：结构化替换引擎

- 先从 Recipe schema、快照函数、应用函数和单项导入导出中删除 `promptReplaceText`；
- 将规则编辑器移动到独立“全局提示词替换规则”卡片，使用独立保存状态和按钮；
- 实现旧 Recipe 规则到 Provider 全局字段的一次性迁移与摘要；
- 将“逐行字符串处理”拆为 parser、validator、evaluator 和 trace；
- parser 一次生成带 `lineNumber` 的 AST，设置保存和生成都消费同一结果；
- evaluator 接收结构化输入段，不直接拼整串；
- 实现五个命名插入段、正文 `替换` 和逐角色 `替换分角色`；
- 保留 `@if`，错误必须指向具体行和片段；
- 增加预览 DTO，只返回测试提示词的各段结果和命中行，不记录用户真实完整提示词到服务日志。

退出条件：七个动作和空值删除的单独与组合 fixtures 全通过；未知动作不能保存；角色 A 的规则不修改角色 B；切换、保存和删除画风串均不改变全局规则，Recipe JSON 不再含该字段。

### Phase 5：最终 Prompt Bundle 与去重

- 将模型注册表、Provider 设置、Recipe 和 Job schema 收窄到 V4.5 Full/Curated；
- 删除 SMEA/SMEA DYN 控件和全链路字段，旧配置规范化后不再导出这些字段；
- 保留 Decrisp，并验证 Full/Curated 的 `dynamic_thresholding` 开关映射；
- 把队列中分散的拼接迁入 `buildFinalNovelAiPromptBundle()`；
- NAI4.5 直接使用 bundle 的基础段、角色槽和坐标；
- 完成 AQT/UCP 单一所有权改造；
- 生成器只负责参数约束和 HTTP payload 映射，不再偷偷二次拼接提示词；
- 保存资产前断言 bundle 的实际串与生成器 payload 相等。

退出条件：覆盖 NAI4.5 Full/Curated 的最终请求快照，所有重复 Tag 案例、角色槽边界和段顺序均可从测试直接看出；界面、配置和 payload 均不存在 SMEA/SMEA DYN；没有 NAI3 运行分支。

### Phase 6：资产快照、重绘和 Tag 修改

- 为资产增加版本化最终 bundle 字段并迁移数据库；
- 新资产保存完整基础段、角色槽、实际串、模型族和规则 trace 摘要；
- 重绘、Tag 修改、局部重绘复用 bundle，不丢角色槽、不重加固定词和质量词；
- 旧资产显示兼容限制；
- 历史页面增加“实际发送 Tag”预览，NAI4.5 分基础/角色展示；旧记录明确提示缺少角色槽快照。

退出条件：同一资产重绘除 seed/显式修改外，出站 prompt bundle 与原请求一致。

### Phase 7：规则编辑体验与角色发送说明

- NovelAI 设置页新增独立于“画风串和模型参数配置”的“全局提示词替换规则”卡片，在规则文本框旁显示七个动作、空值删除说明和八行示例；
- 输入时展示行号错误，保存前强校验；
- 全局规则单独保存并显示未保存状态；切换画风串不触发规则保存，也不覆盖当前规则草稿；
- 增加测试输入与分段结果预览，展示命中规则和去重后的最终 Tag；
- 发送数据页面明确“固定发送”，角色分组页面明确“仅作为自动扫描候选”；
- 请求预览分别列出固定角色、触发命中角色、未命中候选和最终去重后的角色列表。

退出条件：用户不看源码即可判断规则为何命中、角色为何发送以及最终 Tag 如何形成。

### Phase 8：回归、人工验收与文档

- 运行第 7 节全部聚焦测试、类型检查和差异检查；
- 用户授权后执行浏览器人工验收与真实 NovelAI 请求对照；
- 更新 Task 142 的实际实施偏差、验证数字和未执行项；
- 将稳定合同写入 `reference/`，本计划保留为施工记录，不把草案状态伪装成已完成。

## 6. 重点文件

预计修改范围：

- `app/components/novel-ide/text-to-image/TextToImageNovelAiSettingsSection.vue`
- `app/components/novel-ide/text-to-image/TextToImageWorkbenchDialog.vue`
- `app/components/novel-ide/text-to-image/TextToImageSendDataSection.vue`
- `server/text-to-image/prompt-replacement.ts`
- `server/text-to-image/queue.processor.ts`
- `server/text-to-image/novelai-image-generation.ts`
- `server/text-to-image/novelai-quality.ts`
- `server/text-to-image/novelai-models.ts` 或实际模型注册表
- `server/text-to-image/provider.service.ts`
- `server/text-to-image/asset.service.ts`
- `server/text-to-image/asset-postprocess.service.ts`
- `server/text-to-image/schemas.ts`
- `shared/text-to-image-novelai-prompt.ts`
- `shared/dto/text-to-image.dto.ts`
- `prisma/schema.prisma`
- `prisma/project.schema.prisma`
- Provider、队列、生成器、资产后处理、替换规则、Vue 交互的对应测试

实际施工时以 `rg` 找到的调用方为准；不得只修改上述入口而遗漏正文占位符、角色照片、手动生图、重绘和局部重绘。

## 7. 测试矩阵

### 7.1 API Key

- 无 Key、新建 Key、已有 Key 的固定遮罩状态；
- 保存后 DTO/DOM/通知/日志中不存在明文；
- 已保存遮罩不可选择、不可复制，没有“显示 Key”入口；
- 替换成功、同值替换、失败重试、取消、切 Provider、关闭 Dialog、卸载；
- 删除 Key 保留 Provider、画风串和模型参数；
- 编辑其它设置保持 Key；
- 遮罩哨兵提交被拒绝；
- 双击替换/删除只产生一个请求；
- revision 变化后旧排队任务稳定失败，不使用新 Key。

### 7.2 替换规则

- 新 Provider 和缺少 Provider 全局字段的配置使用逐字一致的八行内置默认值；新 Recipe 不含规则字段；
- 显式空字符串保存、重载和切换画风串后仍为空；
- “恢复内置示例”可恢复八行模板，取消确认时不覆盖当前编辑；
- 切换、保存、另存为、重命名、分组和删除画风串均不改变全局规则；
- Provider 全量导入/导出包含一份规则，单画风串导入/导出不包含规则；
- 旧根规则优先、根缺失时取当前 Recipe、再按稳定 ID 回退的迁移结果确定；迁移后所有 Recipe 均无 `promptReplaceText`；
- 入队后修改全局规则不改变已排队 Job，下一次新请求使用新规则；
- 七个动作逐一测试、空值删除和全动作组合顺序；
- `替换|` 删除；
- 多触发词、大小写、中文、NFKC、空白、`@if` 嵌套；
- 未知动作、空触发词、缺 `=`、缺动作分隔符、非法 `@if` 的行号错误；
- 同一规则命中多个角色槽、只命中一个槽、零角色槽；
- 多规则命中同一片段与是否级联的 golden；
- 保存校验、预览和运行时使用同一 parser。

### 7.3 最终 Tag 与 payload

- 固定前词、正文、固定后词、五个插入段、AQT 的精确顺序；
- UCP 与负面提示词顺序；
- 基础/加权/括号/大小写/Unicode/空 Tag；
- 多个加权版本的确定性取舍；
- NAI4.5 基础与每个角色槽独立去重，角色坐标不丢失；
- 非 V4.5 模型在 Provider 设置、Recipe 导入和 Job 入队三层均被拒绝；
- 正负向不跨集合去重；
- AQT/UCP 开关的 payload 与最终元数据不存在双重注入；
- 模型选择、Recipe、Job 和生成器只接受 V4.5 Full/Curated；
- 旧 Full/Curated Recipe 确定性升级到对应 V4.5 模型，未知旧模型回退 V4.5 Full 并给出一次说明；
- 设置页、导入导出 JSON、运行时 DTO 和真实 payload 均不存在 `smea/smeaDyn/sm/sm_dyn`；
- Decrisp 在 V4.5 Full/Curated 下分别把 `true/false` 映射为 `dynamic_thresholding: true/false`，payload 不包含冗余 `decrisp` 键；
- 手动生图、正文生图、角色照片、重绘、Tag 修改、局部重绘使用同一 builder；
- asset bundle、真实 HTTP payload 与历史页“实际发送 Tag”一致。

### 7.4 角色识别

- 启用组 + 正文命中 `|` 触发词：自动发送；
- 启用组 + 正文未命中：不发送；
- 显式触发词为空：只在运行时回退中英文名；
- 未启用组：即使命中也不自动发送；
- 发送数据固定勾选：正文未命中仍发送；
- 同角色固定项覆盖自动项；
- 多启用组同角色只保留优先级最高的生效视觉；
- 请求预览与后端最终输入一致。

### 7.5 审查阻断项

- 四类事务日志并存、活跃/中断/损坏/未知日志与恢复重入；
- Project 切换取消后保存不会写错 Project；
- 等价合并切换目标生效视觉；
- 多版本移动物理删除来源 JSON，失败时同字节恢复；
- 身份确认嵌套 leave guard 后原始动作只继续一次；
- 文档测试数字来自同一次完整聚焦测试输出。

## 8. 验收标准

全部满足才能报告完成：

1. NovelAI 页面明确显示“未配置”或“已保存并使用中”；已保存 Key 只显示固定 `········`，不能再次明文查看或复制。
2. 用户可显式输入新 Key 覆盖，或只删除 Key 而保留 Provider、画风串和模型参数；其它保存不会改变 Key。
3. Key 从不出现在 Provider DTO、错误、通知、日志、URL、本地存储和最终快照中；排队任务不会在 Key revision 变化后静默使用新账号。
4. 七个替换动作及 `替换|` 空值删除全部按第 4.4 节执行；`替换分角色` 逐角色生效；错误规则带行号且不能保存。
5. 新 Provider 和缺少全局字段的配置默认展示逐字一致的八行内置规则；用户主动清空后不会被自动补回，可通过显式按钮恢复。
6. 提示词替换规则独立于画风串保存；切换、保存、另存为、重命名、分组和删除画风串都不会改变它，所有使用当前 Provider 的新请求统一生效。
7. Recipe schema、单项导入导出和规范化后的持久化数据均不存在 `promptReplaceText`；旧配置迁移没有静默丢失当前有效规则。
8. NAI4.5 的基础提示词与各角色槽在各自边界内完成正确去重，并与真实 `v4_prompt/v4_negative_prompt` 完全一致。
9. AQT/UCP 每侧只有一个明确所有者；测试证明开启/关闭时没有重复质量 Tag。
10. 新资产保存的最终 bundle 与真实 NovelAI payload 一致；重绘、Tag 修改和局部重绘不丢角色槽、不二次拼接。
11. 未在发送数据勾选的角色只有在“分组启用且正文命中触发词”时自动发送；固定勾选角色始终发送；请求预览准确说明来源。
12. 设置页只提供 V4.5 Full/Curated，SMEA 与 SMEA DYN 已从界面、Recipe、DTO 和 payload 全部删除；Decrisp 保留且真实控制 `dynamic_thresholding`。
13. 第 3 节五项代码阻断问题均有回归测试并完成修复，文档验证数字一致。
14. 聚焦测试、typecheck 和实际执行命令均有原始结果；未执行真实 NovelAI 或浏览器验收时必须明确写“未执行”，不能用单元测试替代。

## 9. 禁止的实现方式

- 不回传、回填或可逆展示旧 API Key；
- 不把遮罩字符串当真实凭据保存，不用真实 Key 长度生成遮罩；
- 不用删除整个 Provider 代替“删除 Key”；
- 不让画风串自动保存携带或覆盖正在输入的 Key；
- 不继续静默忽略错误替换规则；
- 不把全局替换规则复制进 Recipe、画风串导出或画风串快照，也不让切换画风串覆盖全局规则；
- 不把五个插入位置重新合并成两个字符串；
- 不把 `替换分角色` 实现成全局替换；
- 不保留 NAI3、V4.0 或 SMEA/SMEA DYN 的隐藏兼容分支和无效 Recipe 字段；
- 不保存一个与真实 HTTP 请求不同的“最终 prompt”；
- 不在未确认 AQT/UCP 服务端语义前同时保留手工注入与自动开关；
- 不通过源码字符串包含检查代替 Provider 状态、规则点击、最终 payload 和历史重绘的行为测试；
- 不因为新增 NovelAI 功能而跳过第 3 节审查阻断项。

## 10. 当前验证边界

本计划依据当前工作区源码和既有测试完成诊断；未使用用户真实 API Key，未发送真实 NovelAI 请求，未执行浏览器验收。

尝试运行以下聚焦测试：

```powershell
bun run test -- shared/text-to-image-novelai-prompt.test.ts server/text-to-image/prompt-replacement.test.ts server/text-to-image/queue.processor.test.ts server/text-to-image/novelai-image-generation.test.ts server/text-to-image/asset-postprocess.service.test.ts server/text-to-image/provider.service.test.ts
```

当前环境在启动 Vitest 前失败：

```text
error: could not create process

Bun failed to remap this bin to its proper location within node_modules.
This is an indication of a corrupted node_modules directory.
```

因此本轮对现状的“已验证”指代码链路核对，不代表上述聚焦测试在当前工作区重新通过。正式施工前应先按仓库工作流在独立 worktree 执行 `bun install`，再建立红灯和回归基线；不得把本次依赖损坏记为业务测试失败。
