---
name: character-image-tag-generation
description: Use when a character detail page needs image-tags.md generation for body text-to-image or NovelAI character prompt workflows.
---

# Character Image Tag Generation

Use this skill when generating a character `image-tags.md` file from a Project Workspace character detail page.

## Contract

- Source is the current character detail Markdown, normally `lorebook/character/<name>/index.md`.
- Target directory contains the detail file and `image-tags.md`.
- If the source is already an `index.md` content-node, keep that directory and write `image-tags.md` beside it.
- If the source is a flat Markdown file, create a character-name directory, copy the detail file to `index.md`, and write `image-tags.md` there.
- A child agent extracts visual facts first. It does not generate NovelAI tags.
- The LLM receives only the extracted visual facts and returns structured character tag fields.

## image-tags.md Shape

Use Markdown headings with these sections:

- `角色中文名称`
- `角色英文名称`
- `角色特征`
- `五官外貌`
- `五官外貌背面`
- `上半身 SFW`
- `上半身背面 SFW`
- `下半身 SFW`
- `下半身背面 SFW`
- `上半身 NSFW`
- `上半身背面 NSFW`
- `下半身 NSFW`
- `下半身背面 NSFW`
- `负面提示词`
- `服装列表`

Chinese aliases use `|`, for example `小明|明明`. Outfit rows use `中文名|English name`.

## Boundaries

- Do not include plot-only secrets, motivation, faction politics, or non-visual lore in generated tags.
- Do not move or rename existing character directories automatically.
- Do not write tags for characters other than the selected detail page.
