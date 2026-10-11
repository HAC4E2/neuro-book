# t76 实施计划：书架打磨一

## Context

- **为什么做**：开发者 2026-10-11 看了新应用，书架、工作台、文件树都不如旧应用完善，要求逐页打磨，先书架。对照旧应用的 `ProjectPickerView`（封面网格、空态卡、新建对话框、悬停操作）列差距后，开发者定了：
  - 品牌成品（`.local/brand/logo/06-production/`）进仓库；看板娘（`<neurobook-mood>`）放进空态卡与继续写作卡；
  - 字体：拉丁用字标所用的 Fraunces（OFL，裁成拉丁子集随 nbook 主题带），中文用补全名字的系统宋体栈，界面字不动；
  - 作品目录缺省放在系统文档目录下的 `NeuroBook`（解析不到时 `~/NeuroBook`），不存在就建；旧应用把手稿放进 `~/.local/share` 这类隐藏目录是要避免的。
- **差距与取舍**（2026-10-11 清单）：1 新建流程（本计划 S2、S3）；2 空书架空态卡（S1）；3 “进入工作台”改“用户资产”（S1 文案、S3 行为）；4 字体（S0）；5 书脊悬停与全名提示（S3）；6 新建时选主题色（S1）；7 封面、8 删除目录：不做。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`，每片自跑验证后单独提交；静态稿先给开发者看再做 S2、S3；测试用真实内核与真实目录，不用 mock。

## 关键设计

### 品牌资产（`packages/neuro-book/src/ui/brand/`、`src/web/public/`、`packages/nb-ui/themes/nbook/`）

- 成品复制进仓库，不手改：`neurobook-lockup.svg`（墨色横排组合）、`neurobook-mark.svg`、`neurobook-mood.js`（原生自定义元素）、浏览器图标六个；来源与再生成写在 `src/ui/brand/README.md`。
- `NeuroBookLockup.vue`：成品 SVG 作 CSS 遮罩、`currentColor` 填色，高度由使用方给；`NeuroBookMood.vue`：渲染函数包一层自定义元素（props `state`、`variant`、`paused`），Vite 的模板编译把 `neurobook-*` 当自定义元素。
- 字体：`fraunces-latin.woff2`（可变，四个轴，125 KB）放在 nbook 主题 `assets/fonts/`，`vars.css` 顶部 `@font-face`，`--font-display` 栈为 `"Fraunces", Noto Serif CJK SC/HK/TC/JP、Source Han Serif、Songti SC、STSong、方正书宋、SimSun, serif`。

### 书架页（`src/plugins/projects/web/components/`）

- `BookshelfPage`：标题栏“标志 + 字标 · 书房”；右侧按钮“用户资产”；新增 prop `library`（作品目录，给空态卡）；空书架时上半换成 `ShelfEmptyState`。
- `ShelfEmptyState`（新）：看板娘 `focus`、说明作品是文件夹与新作品建在哪、两个按钮；容器窄时上下排。
- `ContinueCard`：右栏顶上看板娘，今天写了字 `write` 否则 `idle`。
- `ProjectInfoDialog`：主题色在新建时也可选；新建时多一行“位置”：`作品目录/由书名生成的文件夹名`（`projectDirectoryName`，与服务端同一函数）、“更改…”发 `change-location`；`library` 为 null 时写“还没有作品目录”，按钮“选择…”。

### 服务端（`src/server/projects/`、`src/plugins/projects/backend/`）

- 缺省作品目录：服务端算 `<文档目录>/NeuroBook`：Windows `%USERPROFILE%\Documents`，macOS `~/Documents`，Linux 先 `xdg-user-dir DOCUMENTS` 或 `~/.config/user-dirs.dirs` 的 `XDG_DOCUMENTS_DIR`，没有就 `~/Documents`（存在才用），都解析不到时 `~/NeuroBook`。只在设置为空时用；远程合同 `create` 的 `parent` 省略即缺省，另加只读方法 `library`（当前有效的作品目录与来源：设置或缺省）给页面显示。
- 不存在就建：`create` 对缺省目录与设置里的目录都 `mkdir -p` 后再 `checkProjectDirectory`；建不出来按 `invalid-parent` 报，详情带解析后的路径。
- `~` 解析：路径输入（作品目录与“加入已有目录”）的 `~` 与 `~/` 按服务端进程用户的主目录展开；只在服务端做（`checkProjectDirectory` 之前）。
- Spec：`runtime/projects.md` 输出 14（新建）与登记补这三条；`bookshelf.md` 输出 11 去掉 planned。

### 浏览器（`src/plugins/projects/web/`）

- `shelf-page.ts`：`createTarget()` 不再先问路径：读 `library()`，对话框带着它打开；“更改…”才开路径输入，选定后写设置并回到对话框。新建失败 `invalid-parent` 的提示带路径。
- “用户资产”：导航到 `/workbench?reveal=user`（planned 的资源管理器展开用户资产根，随本 Task 在 explorer 里加最小支持：地址参数指定展开的根）。
- 书脊：悬停微抬、`title` 全名。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/bookshelf.md` | 输出 1、2、11（S1 改写，新增部分 planned，S3 去掉）；验收补“空书架引导卡”“新建对话框的位置行” |
| `docs/specs/runtime/projects.md` | 输出 14：缺省作品目录、不存在就建、`~`；远程合同加 `library` |
| 组件同名 `.md` | `BookshelfPage`、`ContinueCard`、`ProjectInfoDialog`、新 `ShelfEmptyState`、`NeuroBookLockup`、`NeuroBookMood` |
| `src/ui/brand/README.md` | 成品来源、再生成、标准色、许可 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S0 | 品牌资产与字体进仓库，Vite 自定义元素，图标 | typecheck；Lab 组件索引测试 |
| S1 | 书架页静态稿（标题栏、空态卡、看板娘、对话框位置行、Lab 场景）与截图给开发者看 | typecheck；组件测试；`lab:shot` 截图 |
| S2 | 服务端：缺省作品目录、不存在就建、`~`、`library` 方法；Spec | `projects.test.ts`、`registry.test.ts`、`identity.test.ts` |
| S3 | 浏览器：新建流程改接、用户资产入口、书脊悬停；e2e | `shelf-page.test.ts`、`bookshelf.e2e.ts` |
| S4 | Spec 去 planned、README、omp 实现审查（非阻塞） | 全量 e2e |

## 验收映射

| 行为 | 测试 |
|---|---|
| 空书架显示引导卡、两个按钮发对应事件 | `ShelfEmptyState.dom.test.ts` |
| 新建对话框：位置行随书名变化、没设作品目录时提示、更改发事件、新建可选主题色 | `ProjectInfoDialog.dom.test.ts` |
| 缺省作品目录：设置为空时新建落在文档目录下的 NeuroBook，目录不存在被建出来 | `projects.test.ts` |
| `~` 展开 | `identity.test.ts` |
| 新建不再先问路径；更改作品目录后写设置 | `shelf-page.test.ts` |
| 真浏览器：空书架到新建第一部作品 | `bookshelf.e2e.ts` |

## 不做与风险

- 不做封面、题材、品牌色进主题。
- 风险：Windows 文档目录被用户移动（已知文件夹重定向）时 `%USERPROFILE%\Documents` 不准，第一版接受，设置里可改。
- 风险：看板娘脚本是生成物，含自己的计时器与鼠标监听，减少动画时自停；Lab 的检查器看不到它内部。
