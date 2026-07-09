---
name: body-image-character-detection
description: Use when body text-to-image generation needs to decide which character image-tags.md files are relevant to a chapter before sending an image prompt request.
---

# Body Image Character Detection

Use this skill when a workflow needs to choose which character `image-tags.md` entries should be injected into a body text-to-image prompt.

## Contract

- Input is chapter text plus candidate characters from Project Workspace `lorebook/**/image-tags.md`.
- Select only candidates that are actually present or semantically active in the chapter.
- A Chinese name field may contain aliases separated by `|`; any alias hit can count as a match.
- Do not return unrelated candidates just because they exist in the project.
- Return structured data with `matches`; do not write image prompts here.

## Output Shape

```json
{
    "matches": [
        {
            "id": "candidate id",
            "sourcePath": "lorebook/character/name/image-tags.md",
            "reason": "why this character is relevant",
            "confidence": 0.9
        }
    ]
}
```

If no candidate is relevant, return an empty `matches` array.
