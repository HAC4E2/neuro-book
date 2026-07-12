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
- The LLM receives only the extracted visual facts and returns structured character and outfit tag fields.
- Parse both the default JSON `outfits` array and one or more `<服装>...</服装>` blocks from an imported character-design prompt.
- Write every returned outfit to the selected character directory's `outfits/` subdirectory.

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

Chinese aliases use `|`, for example `小明|明明`. `服装列表` is an index only. Each row uses a Markdown link whose label is `中文名称/English name`:

```markdown
## 服装列表
- [深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)
```

## Outfit File Shape

Each outfit is maintained independently at `lorebook/character/<character>/outfits/<outfit>.md`:

```markdown
# 深色水手校服/dark navy sailor uniform

## 归属角色
Xiao Ming

## 上半身
white sailor shirt, navy sailor collar

## 上半身背面
white sailor shirt, navy sailor collar

## 下半身
navy pleated skirt, black loafers

## 下半身背面
navy pleated skirt, black loafers
```

When regenerating, update outfits returned with the same Chinese or English name and preserve existing outfit indexes that are absent from the reply. Reject an outfit whose explicit owner does not match the current character.

## Boundaries

- Do not include plot-only secrets, motivation, faction politics, or non-visual lore in generated tags.
- Do not move or rename existing character directories automatically.
- Do not write tags for characters other than the selected detail page.
- Do not embed detailed outfit tags directly in `image-tags.md`.
