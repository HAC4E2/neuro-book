# 角色服装 Markdown 管理设计

## 目标

把角色服装从旧酒馆式前端状态迁移到 Project Workspace 文件真相源。每个角色可以绑定多件服装，角色 `image-tags.md` 只维护索引，每件服装的四个视角部位 Tag 在独立 Markdown 文件中维护。

## 目录与文件契约

角色目录固定采用以下结构：

```text
lorebook/character/<角色目录>/
├─ index.md
├─ image-tags.md
└─ outfits/
   ├─ <服装中文名称>.md
   └─ <另一服装中文名称>.md
```

`image-tags.md` 的服装列表使用显式 Markdown 链接，每行一件：

```markdown
## 服装列表
- [深色水手校服/dark navy sailor uniform](outfits/深色水手校服.md)
- [白色睡裙/white nightgown](outfits/白色睡裙.md)
```

服装名称显示格式固定为 `服装中文名称/服装英文名称`。链接目标相对于角色 `image-tags.md` 所在目录解析。

独立服装文件使用以下结构：

```markdown
# 深色水手校服/dark navy sailor uniform

## 归属角色
Xiao Ming

## 上半身
white sailor shirt, navy sailor collar, red neckerchief

## 上半身背面
white sailor shirt, navy sailor collar

## 下半身
navy pleated skirt, black loafers

## 下半身背面
navy pleated skirt, black loafers
```

## LLM 生成链路

角色详情页沿用“生成角色 tag”入口。角色外貌提取子 Agent 仍只负责提取视觉事实，角色/服装设计 LLM 负责生成角色 Tag 和服装 Tag。

默认提示词要求 LLM 返回 `character` 与 `outfits` 的结构化 JSON。为了消费用户提供的角色与服装设计提示词，同时支持从一个回复中解析多个 `<服装>...</服装>` 块。每个服装必须读取：归属人、中文名称、英文名称、上半身、上半身背面、下半身、下半身背面。

生成服务为每件有效服装创建 `outfits/<服装中文名称>.md`，并把链接写入角色 `image-tags.md`。同名服装重新返回时更新对应文件；本次未返回的已有服装与索引继续保留。归属人明确指向其他角色的服装不绑定到当前角色，并返回警告。

## 正文生图链路

正文生图读取角色 `image-tags.md` 后跟随服装链接加载独立文件。角色识别及提示规划上下文只需要服装名称索引，最终 Prompt 编译器根据 `outfitName`、镜头方向和取景范围确定性选择服装 Tag：

- 正面脸部或上半身：上半身
- 背面脸部或上半身：上半身背面
- 正面下半身：下半身
- 背面下半身：下半身背面
- 全身：对应视角的上半身与下半身

角色身体 Tag、服装 Tag 与基础 Prompt 合并后，再统一应用现有提示词替换规则。

## 边界

- 不恢复旧酒馆式服装管理界面。
- 不建立全局共享服装库；服装归属于角色目录。
- 不根据文件名隐式猜测绑定关系，索引必须包含明确链接。
- 索引链接和生成写入路径都必须留在当前角色的 `outfits/*.md` 目录；跨角色、章节或其他工作区文件的路径不读取也不复用。
- 不删除 LLM 本次未返回的现有服装文件。
- 不让 LLM 直接决定最终注入哪些部位 Tag；该选择由编译器完成。
