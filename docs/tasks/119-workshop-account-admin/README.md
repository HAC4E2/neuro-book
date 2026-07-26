# 119 - nb-workshop 账号体系第二轮：GitHub OAuth + 用户 Profile + 管理员后台

> 状态：**已实施（2026-07-22），待浏览器验收（GitHub OAuth 全链需真实 OAuth App）**。
> 改动全部在 nb-workshop 仓；neuro-book 实例侧零改动。

## Relative documents refs

- **接口唯一真相源**：nb-workshop 仓 `reference/passport/api-v1.md`（本轮扩订 §4 限流合同、§5.1 账号自管理、§5.2 GitHub OAuth、§10 PassportIdentity）。
- 前序任务：`docs/tasks/112-passport-official-site/README.md`（Passport 设备码流 / Backup / requireAccess 地基，本轮直接复用）。
- nb-workshop 现状：nb-workshop 仓 `PROJECT-STATUS.md`。

## User Request / Topic

1. 接入 GitHub OAuth。
2. 加入用户 profile（签名等常见字段）。
3. 加入管理员后台。
4. 由我补充账号基本功能。

## Goal

nb-workshop 完成账号体系第二轮：GitHub OAuth 落地 spec §5 预留的 `PassportIdentity`（关联 / 登录 / 邀请码补全注册三链路）；用户 profile（头像/签名/网站）打通展示位全链；admin 后台扩为六分区（概览 / 邀请码增强 / 举报 / 条目 / 用户管理 / 备份用量）；顺路收掉门 A 安全债中的登录防爆破并补修改密码。约束：现有 94-72=22 个新用例全绿且旧 72 测试零回归；spec 先行。

## Decisions（拍板，勿重议）

1. **GitHub 注册仍需邀请码**：首次 GitHub 登录无绑定 → 补全页填用户名 + 邀请码建号，**免设密码**（`passwordHash` 转可空，null = OAuth 免密账号）。闸门对 OAuth 用户不豁免。
2. **头像 = URL 字段 + GitHub 关联自动填**（账号无头像时才带入），不做本地上传。`avatarUrl` 限 http(s)（防 `javascript:` 进 `<img src>`）。
3. **admin 四块全做**：用户管理 / 站点统计概览 / 备份用量管理 / 邀请码增强（note + 全量列表）。
4. **补充项三个全做**：登录防爆破、修改密码、作者页/展示位吃上 profile。
5. spec 冻结原则不变：上游身份只能**关联**到 NeuroBook 账号（`PassportIdentity`），不能替代它作为主键；解绑守卫=无密码时拒绝（防唯一登录方式被移除后账号失联）。
6. 实施中追加的语义定案：
   - **封禁语义**：status→disabled + sessionVersion+1（在线 cookie 会话即死）；Bearer 面由 passport-guard 既有 user-active 检查同步拒绝（零新增代码）；作者页 404（既有）；**条目不自动下架**（需要时 admin 用条目管理单独 removed）。禁止操作自己（防唯一管理员自锁）。
   - **角色变更也踢线**：session 里的 role 是快照，不踢线会出现降级后前端仍显示 admin 入口但请求全 403 的撕裂态。
   - **登录限流键 = IP+用户名**（10 次/5min）：纯 IP 会误伤共享出口与集成测试；单账号爆破被压死，撒网式换名爆破由邀请码注册闸门兜底。注册（含 OAuth 补全，共享额度）5 次/时/IP；改密 5 次/时/用户。额度 env 可覆写（`NB_LOGIN/REGISTER/PASSWORD_RATE_LIMIT`）。
   - 一个账号每个 provider 只绑一个上游身份（bind 分支预检，重复绑定回 `github=already`）。

## Implementation Walkthrough

### 批次 0：spec 扩订（改接口先改 spec）

`reference/passport/api-v1.md`：§4 限流从「安全债」表述改为正式合同（三条限频 + env 名）；§5 拆 §5.1 基础端点（+`GET/PATCH /me/profile`、`POST /me/password`）与 §5.2 GitHub OAuth（行为矩阵三分支表、`GET/POST /api/auth/register/oauth`、`GET/DELETE /api/v1/passport/identities`）；§10 补 `PassportIdentity` 模型与 User 增量说明；§13 阶段表加 D 行。

### 批次 A：GitHub OAuth

- **Schema**（一次 migration `20260722090724_account_oauth_profile_admin` 收全部变更）：`passwordHash String?`；新表 `PassportIdentity`（`@@unique([provider, providerUserId])`，providerUsername 仅展示快照）；User 加 avatarUrl/bio/websiteUrl；InviteCode 加 note。
- `server/utils/github-oauth.ts`：`resolveGitHubSignIn` 纯决策函数（login/disabled/bind/signup 四分支）+ `suggestUsername`（GitHub login 归一为合法用户名）+ `PendingOAuthSession` 类型。
- `server/routes/auth/github.get.ts`：`defineOAuthGitHubEventHandler` 单路由；bind 分支带同 provider 重复绑定预检 + P2002 并发兜底 + 空头像顺手带入；signup 分支把 pending 身份写 sealed session cookie（不落库）；onError → `/login?error=oauth`。
- **session 语义修正**：`setAuthSession` 从 `setUserSession`（defu merge）改为 `replaceUserSession`——登录/注册整体重建会话，顺带清掉中途放弃补全注册残留的 pendingOAuth。这是本轮最关键的一处基座改动。
- `server/api/auth/register/oauth.get.ts`（补全页读 pending，无则 404）+ `oauth.post.ts`（事务内建免密账号 + PassportIdentity + 条件更新消费邀请码，P2002 兜底；对齐密码注册端点模式）。
- 身份管理：`server/api/v1/passport/identities/index.get.ts` + `[id].delete.ts`（本人校验 404 收敛 + 无密码 400 守卫）。
- `login.post.ts`：`passwordHash === null` 走统一 401 文案（不泄露账号形态）。

### 批次 B：Profile

- `GET/PATCH /api/v1/me/profile`（`toMeProfileDto` 收在 `server/utils/auth.ts`，`hasPassword` 驱动前端密码区形态与解绑提示）；PATCH 成功后 `setAuthSession` 刷新会话（顶栏立即生效）。
- DTO 透出：`ItemAuthorDto` + avatarUrl（改 `toItemAuthorDto` 一处，全部条目/评论查询吃到）；`PublicUserDto` + avatarUrl/bio/websiteUrl；`AuthUserDto` + avatarUrl。
- `app/components/UserAvatar.vue`：img（onerror 回落）+ 用户名 hash 恒色首字母色块；消费点：AppHeader / ItemCard / 条目详情作者行 / ItemComments / 作者页头部（bio + 网站外链 `rel=noopener`）。
- `me.vue` 第 5 tab「账号设置」= `AccountSettingsPanel.vue`（资料表单含头像实时预览 / GitHub 绑定区含解绑两步确认与免密禁解绑提示 / 密码区按 hasPassword 切「修改/设置」形态）；me.vue 吃 `?tab=account&github=linked|already|conflict` 回跳提示并清 query。

### 批次 C：Admin 后台

- 新端点（全 `requireAdmin`）：`admin/users.get`（搜索/分页/_count 条目/hasGithub/hasPassword）、`users/[id]/status.patch`（封禁踢线 + self-guard）、`users/[id]/role.patch`（变更踢线 + self-guard）、`admin/stats.get`（一把 aggregate 十项数字）、`admin/backup-usage.get`（groupBy 用户聚合按占用倒序）、`admin/backups.get`（行明细可按 userId 过滤）、`admin/backups/[id].delete`（对齐用户侧删除的行先删+文件 best-effort 模式）、`admin/invite-codes.get`（used/unused 过滤分页）。
- `shared/dto/admin.dto.ts` + `server/utils/admin-dto.ts`（PageQuerySchema 复用自 workshop-dto）。
- 前端 `/admin` 扩为六 tab，概览为默认；新面板抽组件 `app/components/admin/`（AdminStatsPanel 数字卡片 / AdminUsersPanel 行内封禁与角色两步确认 Dialog / AdminBackupsPanel 聚合行点开明细可删 / AdminInvitesPanel 从 admin.vue 抽出并加 note 与全量列表）；举报与条目管理逻辑留在 admin.vue（257→~250 行，未膨胀）。

### 批次 D：防爆破 + 修改密码

- `consumeRateLimit` 复用 + 新 `envRateLimit(name, fallback)`；login/register/register-oauth/password 四端点接入。
- `POST /api/v1/me/password`：验旧密（401）或免密补设；成功 sessionVersion+1 **先踢他端再重写当前会话保活**（顺序不能反）。

### 前端路由坑

`register.vue` 与新 `register/github.vue` 并存会被 Nuxt 解析成父子嵌套路由（父页无 `<NuxtPage>` → 子页渲染空白）——`register.vue` 移为 `register/index.vue` 变平级路由。

## Verification / Test

已执行（2026-07-22）：

- **typecheck 零错误**；build 绿。
- **全量测试 94/94 绿**（8 文件）：旧 72 零回归 + 新 22：
  - `tests/github-oauth.test.ts`（7 纯函数用例）：三分支矩阵（含封禁不回落、已登录他人切换）+ suggestUsername 归一/截断/补长。
  - `tests/account-admin.integration.test.ts`（15 用例，真实 build 产物 + 独立 server/DB，端口 35600+pid）：邀请码 note+used/unused 过滤+非 admin 403；OAuth 补全守卫（无 pending GET 404/POST 400）；身份列表/解绑（越权 404、有密码可解绑）；**免密账号全链**（直改库构造 OAuth 形态：密码登录统一 401→hasPassword=false→解绑 400→免旧密补设→可登录可解绑）；profile（合法生效、`javascript:` avatarUrl 400、bio 超长 400、作者页与条目 author 全链透出）；改密（旧密错 401、他端会话死当前保活、新旧密码登录面）；admin 用户管理（搜索字段、封禁→cookie 即死+登录 401+**Bearer 401**+作者页 404→解封恢复、self-guard 400、角色授予/收回踢线重登后 stats 200/403）；统计口径；备份用量（Bearer 上传→聚合→行明细→admin 删除→归零）；登录限流 429（IP+用户名键，10 次后 429 且不殃及他人，放文件最后）。
  - GitHub 绑定态测试策略：真实上游回调无法在测试内走通，绑定行为由纯函数单测覆盖决策、集成测试直改库构造 `PassportIdentity` 行验证绑定后的管理面契约。
- 旧测试防限流误伤：`api-v1.integration.test.ts`（同 IP 注册 8 次）与 `passport-backup.integration.test.ts` 的 server env 补 `NB_REGISTER_RATE_LIMIT=1000`。

待用户执行（浏览器验收）：

- GitHub OAuth 全链：建 GitHub OAuth App（回调 `http://localhost:3003/auth/github`，env `NUXT_OAUTH_GITHUB_CLIENT_ID/SECRET`）→ 登录页「使用 GitHub 登录」→ 补全页（邀请码）建号 → 设置页解绑守卫/补设密码 → 绑定/已绑定登录/封禁账号拦截。
- me 五 tab（账号设置：资料保存后顶栏头像即时刷新）、作者页/卡片/评论头像展示、admin 六 tab 走查。

## 与计划出入

1. **零偏差实施**，另有三处计划外补充：`GET /api/auth/register/oauth`（补全页需要读 pending 身份展示，spec 已同步）；`GET /api/v1/me/profile`（表单预填与 hasPassword 需要读端点，spec 已同步）；`admin/backups.get` 行明细端点（只有聚合无法定位要删的备份 id）。
2. 登录限流键从计划的「IP」细化为「IP+用户名」（发现纯 IP 会打爆旧集成测试 → 顺势选了对共享出口更友好的键，见 Decisions #6）。
3. 角色变更加了计划外的踢线（session role 快照撕裂问题，见 Decisions #6）。
4. admin.vue 重写时发现 Nuxt 嵌套路由坑（register.vue → register/index.vue），计划未预见。

## TODO / Follow-ups

- [ ] 浏览器验收（用户）：GitHub OAuth 全链 + me 账号设置 + admin 六 tab + 头像展示位。
- [ ] GitHub OAuth App 生产配置（正式域名回调地址）；`DEFAULT_PASSPORT_SITE_URL` 回填仍挂在 Task 112 TODO。
- [ ] 后续（不在本任务）：邮箱注册/验证；更多 OAuth provider（PassportIdentity 已是自由 provider 字符串，只需加回调路由）；admin 恢复 removed 条目的目标状态语义（旧遗留）；评论纯文本→富文本（旧遗留）。
