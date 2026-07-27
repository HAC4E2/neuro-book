# Task 128 实施记录（2026-07-27）

## 当前状态

正在执行 Phase 1。服务器、DNS、证书、GitHub 仓库、GHCR 和 443 尚未修改。

## 批次 1：合同、改名与依赖基线

- sibling 目录已从 `nb-workshop` 硬切为 `neuro-book-site`。
- 官方站 package、meta platform、主题 storage key、页面品牌与活动文档已同步改名。
- Passport / Backup wire spec 已硬切到 `keyId`、密文 sha256、`.nbbackup` 和 `application/vnd.neurobook.backup`。
- `@notnotype/nb-ui` 已固定到公开 commit `e57c6b6a303a9cd981d761d089ccf7dfcafb1cba`；`bun install` 已重建 lockfile，不再依赖 Bun link。

## 批次 2：NeuroBook 加密与密钥生命周期

- Runtime Paths 新增 `secretsRoot` 与 `backupKeyringPath`。
- keyring 使用 `pending / active / historical` 三态、同目录临时文件原子替换、目录 `0700` 与文件 `0600`；不提供历史密钥删除。
- 恢复码固定为 `NBK1-<43 字符 base64url>-<8 字符 checksum>`；`keyId` 取 SHA-256 前 8 字节。
- 归档格式硬切 v2，压缩输出直接进入 AES-256-GCM，不再落完整明文 zip；`secrets/` 不进入归档。
- SQLite `VACUUM INTO` 失败时整次备份终止，不再退化为原文件拷贝。
- 恢复先下载并校验密文 sha256，再第一遍完整验证 GCM，验证成功后第二遍流式解密解包；staging 写入本次恢复密钥。
- 应用日志与任务错误的敏感字段规则已覆盖 `recoveryCode`、`backupKey`、keyring 和裸 `NBK1` 恢复码。

## 批次 3：恢复码前端闭环

- 新增独立恢复码 Dialog；完整恢复码不进入备份列表、任务状态或全局通知。
- 第一次备份必须先准备 pending key。复制或下载至少一项成功后，用户才能勾选“已保存在本实例之外”，两项同时满足才可确认并上传。
- 取消 Dialog 不确认、不上传；服务端保留同一 pending key，下一次打开复用。
- 缺少备份 `keyId` 时先导入恢复码；导入后仍要求用户再次确认恢复。
- 设置页显示 active / historical / pending keyId，支持主动轮换，以及本地鉴权启用时经当前账号密码复验重新导出。

## 验证

- `bun run test -- ...`：加密、keyring、归档、恢复、Runtime Paths、日志脱敏与前端合同共 7 个文件、30 项测试通过。
- 两次 `bun run typecheck` 均未发现 Task 128 新增类型错误；全量命令仍失败于已有 `server/agent/skills/llmlint.test.ts` 夹具缺少 `ignoreTerms` 及一个旧 source 类型断言。本任务未修改该无关在途链路。
- 按项目约束未自动执行浏览器验证。

## 与计划的出入

- 无密码学合同降级。
- 前端行为验证沿仓库既有 Node-only Vitest 方式使用源码合同测试；真实浏览器交互仍留在用户授权后的验收阶段。

## 批次 4：公开仓库、GHCR 与 DMIT loopback

- sibling 仓已硬切为 `neuro-book-site`，公开仓库为 `https://github.com/notnotype/neuro-book-site`，无 LICENSE；GHCR 匿名拉取 SHA tag 成功。
- Run `30248630556`（提交 `57711d2`）和 Run `30253386014`（提交 `7966bf1`）的 verify/container 均成功；DMIT 匿名拉取两个 digest 均成功。
- DMIT 已安装 Docker Engine `29.6.2`、Compose `v5.3.1`；`/srv/neuro-book-site` 使用 UID/GID `10001` 数据目录 `0700`、root-only `.env` `0600`，Compose 只发布 `127.0.0.1:3100`。
- 空卷 migration/ready、stdin 管理员初始化、Secure Cookie、owner-only 注册/OAuth 门禁、Workshop ZIP、`.nbbackup` 上传下载、容器强制重建和主机重启后的摘要持久性均通过。
- DMIT 主机重启后 Docker、Nginx、Xray 均 active；同盘冷快照满足“数据体积 + 4 GiB”门禁，整体恢复后数据库摘要、文件数和 readiness 一致。
- 实际演练新 digest → 旧 digest → 新 digest，三次均 readiness 通过且数据库/文件摘要一致；最终保持新 digest。DMIT 整盘损坏仍会同时丢失站点数据和同盘快照，这是已锁定的私有内测风险。

## 批次 5：DNS 前置与 443 runbook

- 已备份 `/etc/nginx`、`/etc/v2ray-agent` 和 Xray systemd unit 到 `/srv/neuro-book-site/ops/backups/task128-20260727T092738Z/`，并保存 root-only `.env` 镜像回滚副本。
- Nginx 80 端口已添加 ACME webroot vhost；challenge 回读通过，根路径保持 404。现有 dmit 443 用本机 TLS 1.3 握手验证通过，Xray 配置和 443 归属未改。
- sibling 仓新增 `docs/https-443-runbook.md`，记录 DNS、ACME、非 443 SNI/PROXY protocol 预演、上传限制、443 dry run、配置备份和原 Xray 443 回滚命令。
- DNSPod 当前没有登录态，浏览器停在登录页；本机没有 DNSPod/Tencent CLI 或现成 API 授权。因此 `nbook.notnotype.com A 64.186.225.48 TTL 300`、证书签发、非 443 TLS 预演和 443 切换保持 pending，未绕过登录门禁。

## 当前验证结论

- 代码与容器生产化、DMIT 内部部署和本机回滚证据已完成；443 尚未切换，`DEFAULT_PASSPORT_SITE_URL` 尚未改，NeuroBook canary 尚未发布。
- 按项目约束未自动执行浏览器产品验收；真实设备码关联、Bearer Workshop、首次恢复码保存、密文恢复和 staging 恢复仍等 HTTPS 稳定后并经用户授权执行。
