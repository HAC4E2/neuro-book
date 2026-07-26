# Character Proposal 保存与临时角色 Tag 设计

## 目标

修复角色视觉 Proposal 在模型完成后保存时产生的 500 错误；当正文生图没有匹配到已登记角色时，允许 Director 为单次镜头生成临时角色 Tag，而不污染角色视觉档案。

## 已确认问题

`POST /api/text-to-image/character-image-tags` 的 Director 调用已经完成。失败发生在 `saveDirectorProposal()` 写入 proposal control file 时：生产 store 将 `writeWorkspaceTextFileTracked()` 的 Promise 再次作为参数传入同一函数，且没有构造 `WorkspaceFileTarget`。History 包装层访问 `target.kind` 时因此抛出 `TypeError`，请求返回 500。

正文生图的 `ShotIntentCore` 已允许空 `characterIds`，Compiler 也能编译无角色镜头；缺失的是对 Director 的明确合同说明。当前提示词和 `chapter-illustration-direction` skill 禁止自由 Tag 字符串，却没有说明无已登记角色时应以 Tag resolver 生成 run-scoped 的临时外貌/服装语义。

## 设计

### 1. Proposal 采用显式 Project 写入目标

`CharacterVisualMigrationFileStore.write()` 的输入携带 `projectPath`、已解析 `root`、相对文件路径、内容与 `knownBefore`。`CharacterVisualMigrationService.project()` 返回这两个 Project 身份字段，并在所有写入点原样传递。

生产 store 只调用一次 `writeWorkspaceTextFileTracked()`，传入：

```ts
{
    target: {kind: "project-workspace", projectPath, root},
    filePath,
    content,
    knownBefore,
    actor: USER_LOCAL_ACTOR,
}
```

索引失效使用同一个准确的 `projectPath` target。绝不由绝对路径反推 Project 身份，也不使用 `any` 绕过 target 合同。

### 2. 无已登记角色时的临时 Tag 规则

当正文或选区未匹配到 `planningInput.characters` 中的角色：

- Director 把 `characterIds` 和 `action` 保持为空，绝不伪造或引用闭集外角色 ID；
- Director 根据该镜头正文，通过既有 Tag resolver 工具取得 terminal resolutions，并把临时外貌、服装、体型或可见角色特征写入当前 Shot 的 `tagDelta.prefer` / `tagDelta.avoid`；
- 临时 Tag 只随该 Shot、Storyboard 与执行 Manifest 存在；不得写入 `lorebook/character/**`、角色 registry 或后续镜头的连续性基线；
- 已匹配角色时继续使用已有 `characterIds` 和已锁定的角色视觉通道，不以临时 Tag 覆盖它。

这沿用现有“terminal resolution ref，而非自由字符串”的结构化边界：模型可自由决定角色形象，但每个 Tag 仍由当前 run 的 resolver 验证并可追溯。

### 3. 提示词与技能合同

更新 `illustration.director.profile.tsx` 的 `plan-chapter` / `plan-selection` 操作说明，以及 `chapter-illustration-direction/SKILL.md`。两处使用相同语义：无已登记角色不是阻塞条件；使用空角色引用和当前 run 的 Tag resolution 表达镜头人物。保留“禁止提交最终 Prompt / 自由 Tag 字符串”的约束。

## 测试与验收

1. 为生产迁移 store 提供真实 Project target 的回归测试：生成 Proposal 后控制文件写入成功，并记录 Project History；测试应在修复前因缺失 target 失败。
2. 为计划校验/编译增加无角色镜头 fixture：`characterIds: []`、`action: {}`，但存在 terminal transient Tag resolution；验证通过后生成的 `characterPrompts` 为空，而全局 prompt 包含经解析的 Tag。
3. 增加 Profile/Skill 文本合同测试，锁定无角色的临时 Tag 指令，避免后续提示词回归为阻塞行为。
4. 运行受影响的 Vitest 测试及 `bun run typecheck`；通过后重新执行 `nuxt:build -> product:stage -> desktop:tauri -> desktop:assemble`，并核验 Portable 产物含修复源码。

## 非目标

- 不创建虚假角色档案、服装档案或永久角色 ID。
- 不修改已有角色 V2 视觉数据、Tag resolver 策略或 Storyboard 审批机制。
- 不放宽模型直接提交未解析自由 Tag 字符串的边界。
