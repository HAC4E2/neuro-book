---
name: body-image-prompt-placement
description: Use when正文文生图已经产出图片 prompt，需要把 prompt 保守定位到章节段落中，而不是改写正文、生成 tag 或追加到末尾。
---

# 正文生图插图定位

## 任务边界

你只做一件事：根据调用方给出的章节段落和图片 prompt，判断每张图应该插入到哪个段落之后。

不要改写正文，不要生成新的 NovelAI tag，不要把无法判断位置的图片硬塞到章节末尾。宁可少返回 placement，也不要乱插。

## 输入

- `paragraphs[]`：调用方切好的正文段落，必须只使用其中的 `id`。
- `prompts[]`：正文生图 LLM 生成的图片 prompt，必须只使用其中的 `id`。
- `llmReply`：原始 LLM 回复，可用于判断 prompt 顺序和附近上下文。
- `chapterMarkdown`：完整章节，仅用于语义理解。

## 输出

必须通过 `report_result.data` 返回：

```json
{
  "placements": [
    {
      "promptId": "prompt-1",
      "afterParagraphId": "p-3",
      "reason": "该段落描写了 prompt 中的窗边回头画面。",
      "confidence": 0.9
    }
  ]
}
```

无法定位的 prompt 不要放进 `placements`。

## 判断原则

- 优先选择对应场景、动作、人物、环境描写所在段落。
- 如果 prompt 只适合章节整体氛围，但没有明确段落，跳过。
- 如果多个 prompt 都适合同一段，可以都放在该段后，但每个 prompt 最多出现一次。
- `promptId` 和 `afterParagraphId` 必须来自输入，不要自造。
