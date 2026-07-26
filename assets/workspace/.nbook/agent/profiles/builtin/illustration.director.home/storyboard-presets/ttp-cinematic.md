---
schema: nbook.storyboard-preset/v1
presetId: ttp-cinematic
patternSetId: ttp-cinematic
packageId: ttppkg_01JQ6KX2NP
resourceKey: ttp-cinematic--d01a4a16
title: TTP 电影化分镜预设
enabled: true
source:
  kind: ttp
  importId: ttps_01JQ6KX2NP
  rawSourceHash: sha256:548b75a5385d0f0562e3251525bcd85d298a8764973df97d4f74ac37a2ded867
  sanitizedSourceHash: sha256:548b75a5385d0f0562e3251525bcd85d298a8764973df97d4f74ac37a2ded867
  converterVersion: "1"
review:
  status: pending
matching:
  normalization: nfkc-casefold
defaults:
  preferredShotCount:
    min: 5
    max: 7
  minimumParagraphGap: 2
macros:
  bindings: {}
  unresolved: []
rules:
  - ruleId: ttp.shot-select.even-5to7
    sourceEntryId: 089bf996-72cd-49f9-908c-e51f63152e84
    order: 100
    enabled: true
    kind: shot-selection
    when:
      mode: always
      any: []
      andAny: []
    effect:
      operation: prefer
      beatTypes: ["establishing", "action", "reaction", "reveal"]
      distribution: even
      scoreDelta: 20
    provenance:
      conversion: normalized
      sourcePaths: ["entries.6.content"]
  - ruleId: ttp.shot-density.prefer-5to7
    sourceEntryId: 089bf996-72cd-49f9-908c-e51f63152e84
    order: 200
    enabled: true
    kind: shot-density
    when:
      mode: always
      any: []
      andAny: []
    effect:
      preferredMin: 5
      preferredMax: 7
      charactersPerShot: { min: 1, max: 2 }
    provenance:
      conversion: normalized
      sourcePaths: ["entries.6.content"]
  - ruleId: ttp.composition.single-instant
    sourceEntryId: 00be1a4a-7121-4a75-895c-482c352ddf27
    order: 300
    enabled: true
    kind: composition
    when:
      mode: always
      any: []
      andAny: []
    effect:
      temporalMode: single-instant
      maxSubjects: 4
      avoidCompoundActions: true
    provenance:
      conversion: direct
      sourcePaths: ["entries.8.content"]
  - ruleId: ttp.canvas.default-portrait
    sourceEntryId: entry_1782139931109_3
    order: 400
    enabled: true
    kind: canvas-intent
    when:
      mode: always
      any: []
      andAny: []
    effect:
      canvasIntent: portrait
    provenance:
      conversion: normalized
      sourcePaths: ["entries.12.content"]
  - ruleId: ttp.canvas.multi-landscape
    sourceEntryId: entry_1782139931109_3
    order: 410
    enabled: true
    kind: canvas-intent
    when:
      mode: trigger
      any: ["2girls", "2boys", "group"]
      andAny: []
    effect:
      canvasIntent: landscape
    provenance:
      conversion: normalized
      sourcePaths: ["entries.12.content"]
  - ruleId: ttp.canvas.closeup-square
    sourceEntryId: entry_1782139931109_3
    order: 420
    enabled: true
    kind: canvas-intent
    when:
      mode: trigger
      any: ["close-up", "face", "expression"]
      andAny: []
    effect:
      canvasIntent: square
    provenance:
      conversion: normalized
      sourcePaths: ["entries.12.content"]
  - ruleId: ttp.constraint.char-limits
    sourceEntryId: 00be1a4a-7121-4a75-895c-482c352ddf27
    order: 500
    enabled: true
    kind: constraint
    when:
      mode: always
      any: []
      andAny: []
    effect:
      maxSubjects: 4
      forbidDuplicateBeat: false
      requireValidAnchor: true
    provenance:
      conversion: normalized
      sourcePaths: ["entries.8.content"]
risks: []
---

# TTP 电影化分镜预设

从 TTP（text-to-picture）LLM 预设（万古至尊天下无敌修改版）转换而来的全局 Storyboard 规则。
运行时只读取并校验 frontmatter；正文仅供人类解释。

## 规则概览

- 分镜数量：5-7 张，均匀分布于正文段落间
- 画面构图：单瞬间定格（single-instant），禁止连续动作过程
- 角色限制：单图 ≤4 人总角色，≤2 人女性角色
- 画幅选择：竖屏 portrait（全身/单人）→ 横屏 landscape（多人/大景）→ 正方形 square（面部特写）
- 结构约束：maxSubjects=4，requireValidAnchor

## 配套 Tag Pattern

本预设必须与同 `patternSetId` 的 Tag Pattern Set 配对使用。
Tag Pattern 从 TTP 预设的 450+ 场景模板中提取，
由 illustration.director 在章节规划时根据语义匹配并展开。
