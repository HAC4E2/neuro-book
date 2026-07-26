---
schema: nbook.storyboard-preset/v1
presetId: default
patternSetId: default
packageId: default
resourceKey: default
title: 默认分镜预设
enabled: true
source:
  kind: builtin
  assetVersion: 1.0.0
review:
  status: approved
  approvedSemanticHash: sha256:494c9854b9f7afbcb198d5b8dac39d5f70bbb9e76190a872298a5ede7d759b73
  approvedDiagnosticHash: sha256:c2f40b0709c1a7bd0b8af035c055fd177111f3bcf076afa31b127e2cb6bdf305
  approvedRawSourceHash: null
  approvedSanitizedSourceHash: null
matching:
  normalization: nfkc-casefold
defaults:
  preferredShotCount:
    min: 3
    max: 8
  minimumParagraphGap: 3
macros:
  bindings: {}
  unresolved: []
rules:
  - ruleId: default-shot-selection
    order: 0
    enabled: true
    when:
      mode: always
      any: []
      andAny: []
    kind: shot-selection
    effect:
      operation: prefer
      beatTypes:
        - action
        - reveal
        - establishing
      distribution: balanced
      scoreDelta: 0
  - ruleId: default-composition
    order: 1
    enabled: true
    when:
      mode: always
      any: []
      andAny: []
    kind: composition
    effect:
      shotSize: medium
      cameraAngle: eye-level
      viewpoint: objective
  - ruleId: default-canvas
    order: 2
    enabled: true
    when:
      mode: always
      any: []
      andAny: []
    kind: canvas-intent
    effect:
      canvasIntent: portrait
risks: []
---
# 默认分镜预设

系统内置的默认分镜预设，提供基础的画面选择和构图规则。
