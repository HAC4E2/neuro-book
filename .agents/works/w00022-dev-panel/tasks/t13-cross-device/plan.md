# t13 实施计划：跨设备访问

草案，交主 Agent 与设计审查（编码子代理 2026-10-13 写）。范围以 [实施计划的 t13 一节](../t03-design/plan.md#t13-跨设备访问)（场景 1 到 6）与本目录的 [README](README.md) 为准，开发者 2026-10-13 的两个决定优先：
- 现阶段先用 SSH 端口转发，跨设备在 t11 之后做；
- 别的设备登录后与本机权限相同，不分级。所以场景 3 作废。

设计依据：
- [Proposal](../../../../../docs/proposals/dev-panel.md) 第八节（访问与安全）、待决问题 11 与末尾的决策记录；
- 下文“计划前的实测”，都是只读查询，没有改 Tailscale 的任何配置；
- 已有代码，集成分支 `305c3f1d4`：
  - t09 的启动令牌登录：`src/server/auth.ts`，`.local/agent/panel.json`，一次性票据；
  - 请求校验：`src/server/guard.ts` 与 `serve.ts` 的 `handlePanel`，即转发头、Host、`Sec-Fetch-Site`、Origin、CSRF；
  - 两个来源；
  - t10 到 t12 的写接口、`/ws`、`/ws/terminal`；
  - 审计的 `device` 字段，t12 之前一律 `local`；
  - t12 预留的“终端连接记下登录会话”与 `TerminalHub.closeLoginSession`。

## Context

- **要解决的问题**：现在只能在本机或经 SSH 端口转发用面板。开发者要在手机上看记录与产物、答题、看会话。
- **前提**：t09 到 t12 已在集成分支上，t12 推到了 `305c3f1d4`。t11 已合入 master，审计已初始化，面板以 systemd 服务 `nbdev-panel-neuro-book.service` 常驻。
- **工作方式同前**：
  - 集成分支 `feat/w00022-dev-panel`，每片单独提交，编码子代理不 push；
  - 测试与浏览器验收只在临时仓库上做；
  - 不碰常驻面板，也不碰它的 `panel.json` 与锁；
  - **不改 Tailscale 的任何配置**：实施期间也只读，需要配置的步骤都由开发者执行。
- **范围**：
  - 设备配对：`nbdev panel pair`；
  - 设备令牌、有效期、吊销：`nbdev panel devices`，以及面板里的设备页；
  - 认 Tailscale Serve 转发来的请求，即新的 tailnet 来源；
  - 配对前的关门与 `0.0.0.0` 拒绝；
  - 审计记设备、配对与吊销；
  - Tailscale Serve 的配置说明与检查命令 `nbdev panel tailnet`；
  - 配对页与设备页的手机布局。
- **不做**：分级（“只看”与“可操作”）；面板自带 TLS 的局域网直连；Tailscale funnel；跨 tailnet 的访问。

## 计划前的实测（2026-10-13，只读）

| 项 | 结果 |
|---|---|
| Tailscale | 客户端与 tailscaled 都是 1.102.4。tailscaled 以 root 运行（`/usr/sbin/tailscaled --socket=/run/tailscale/tailscaled.sock`），单元里没有 `ProtectHome` 一类的沙箱 |
| 本机节点 | `<本机>.<tailnet>.ts.net.`，`<本机的 tailnet 地址>`，所有者 `<所有者的登录名>`；MagicDNS 开着 |
| HTTPS 证书 | `tailscale status --json` 的 `CertDomains` 是 null：**tailnet 还没开 HTTPS 证书**，`tailscale serve --https` 要先在管理后台的 DNS 页打开 |
| serve | `tailscale serve status` 回 No serve config，`--json` 回 `{}`；没有 funnel |
| operator | `tailscale debug prefs` 的 `OperatorUser` 是 null：不加 sudo 改不了 serve 配置 |
| **tailnet 里有别人的设备** | 7 个对端里，`<他人的设备 A>` 属于 `<另一位用户>`，`<他人的设备 B>` 属于 `<又一位用户>`；都在网络图里，不是分享进来的节点（`ShareeNode` 为空）。ACL 没读（要管理后台权限），**按缺省的全通处理**：这两台设备能连到本机的 serve 端口 |
| 手机 | 对端里有一台 `localhost`（android，属于开发者，当时离线），应是开发者的手机 |
| serve 的转发头 | tailscaled 二进制里有 `Tailscale-User-Login`、`Tailscale-User-Name`、`Tailscale-User-Profile-Pic`、`Tailscale-Headers-Info`、`Tailscale-Funnel-Request`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-For` 这些头名。“转发前先删掉客户端自带的同名头、再按来源节点填上”是按上游源码写的，**本机没有实测**（实测要改 serve 配置） |
| **头能不能伪造** | 能。回环上的任何进程都能带着 `Tailscale-User-Login: <所有者的登录名>`、`X-Forwarded-For` 与任意 `Host` 连 `127.0.0.1` 的端口，服务端照收（会话临时目录 `forge-demo.ts`，用完已关）。本机另有两个可登录的账户，它们的进程同样能连回环 |
| unix socket | Bun 1.4.2 的 `Bun.serve({unix})` 能在 unix socket 上收 HTTP 与 WebSocket 升级（101 之后收到帧），socket 文件缺省权限 755。`tailscale serve --help` 写明 target 可以是 `unix:/path` |
| 二维码库 | `uqr` 0.1.3（2026-04-03，MIT，零依赖），能出终端用的 Unicode 方块；`qrcode` 1.5.4 带 `yargs` 等三个依赖 |

## 关键设计

### 一、tailnet 来源：Tailscale Serve 只转发到 unix socket

**核心判断：面板不能靠请求头认出“这是 Tailscale 转发来的”。** 同一个 TCP 回环端口上，本机任何进程都能伪造这些头（见实测），包括另外两个账户。所以把“经 Tailscale 来的请求”放到一个只有 tailscaled 与开发者本人连得上的入口：

- **两个新的监听**（只在 `panel serve --tailnet` 时开）：面板与产物各一个 unix socket。
  - 路径是 `$XDG_RUNTIME_DIR/nbdev/<主工作区目录名>-<主工作区路径哈希 8 位>/panel.sock` 与 `artifact.sock`；没有 `XDG_RUNTIME_DIR` 时用主工作区的 `.local/agent/run/tailnet/`。
  - 目录 700、socket 600，属主是开发者；启动时核对，权限不对就不开 tailnet 来源，并写明原因（失败关闭）。
  - tailscaled 是 root，能连（单元没有沙箱，见实测）；本机其它账户连不上。
  - 开发者本人的进程（含 Agent）连得上：它们本来就能读 `panel.json`、直接调 herdr，不在这道门要防的范围里。
- **原来的两个 TCP 回环来源不变**：
  - 仍然拒绝一切转发头，`rejectForwarded` 原样保留；
  - 仍然只认 `127.0.0.1`、`localhost` 的 Host，只认 `panel open` 的本机会话。
  - 所以把 serve 错指到 `127.0.0.1:4400` 照样失败关闭，见第四节。
- **tailnet 来源上的校验**，按顺序，失败一律 4xx：
  1. tailnet 状态读得到（第三节的探测）；serve 的配置里这两个端口没有开 funnel；请求没带 `Tailscale-Funnel-Request`。
  2. 有 `X-Forwarded-Proto: https`。
  3. 有 `Tailscale-User-Login`，并且等于本机节点的所有者登录名（`<所有者的登录名>`，从 `tailscale status --json` 读）。tagged 节点不带这个头，一律拒绝。这一道防的是 tailnet 里别人的设备，见实测。
  4. `Host` 在 tailnet 白名单里（第三节）。
  5. 面板来源的 `/api/*`、`/ws` 要有效的设备令牌（第二节）；`/pair` 与静态页面不要。
  6. 写请求、`/ws` 与 `/ws/terminal` 的升级：`Origin` 必须是 `https://<主机名>`（外部端口不是 443 时带上端口），`Sec-Fetch-Site` 只认 `same-origin` 与 `none`，写请求另带 `X-Nbdev-Csrf`。这三样与回环来源相同，只是 Origin 换成 https。
- **cookie**：
  - tailnet 来源发 `__Host-nbdev_device_<外部端口>=<设备 id>.<令牌>; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=<到绝对期限的秒数>`。`__Host-` 前缀把 cookie 钉在这个主机名上，不能带 `Domain`。名字带外部端口，原因与 t09 相同：同一主机名上有两个面板时不互相顶掉。
  - cookie 不按端口隔离，所以产物端口（8443）的请求也会带上它；产物来源不读 cookie，cookie 又是 HttpOnly，产物页的脚本拿不到。
  - 回环来源的 cookie 不变：`nbdev_panel_<端口>`，没有 `Secure`。
- **CSP 与地址**：
  - tailnet 来源的面板页：`connect-src 'self' wss://<主机名>`，`img-src`、`frame-src` 指 `https://<主机名>:<产物外部端口>`；
  - 产物来源：`frame-ancestors https://<主机名>`；
  - `/api/meta` 的 `artifactOrigin`、`artifactBase` 按请求所在的来源算，回环来源上算出来还是 `http://127.0.0.1:4401` 这一类。
- **只用 serve，不用 funnel**：
  - 文档只给 serve 的命令，核对用 `tailscale funnel status` 应为空；
  - 面板每次探测都读 `tailscale serve status --json` 的 `AllowFunnel`：这两个端口一旦开了 funnel，tailnet 来源一律回 503 并写日志与 `/api/meta`；
  - 带 `Tailscale-Funnel-Request` 的请求一律 403。

### 二、设备配对、令牌与有效期

- **设备库** `~/.config/nbdev/devices.json`（600），与审计同一个目录（700）：
  - 只在审计已初始化、目录检查通过时可用，否则配对与设备登录都不开放，写明原因；
  - 读改写经 `src/core/lock.ts` 的目录锁（`devices.lock`），写临时文件再改名；
  - 面板与命令行都写它：面板写配对、最近使用时间与页面上的吊销，命令行写吊销。

```json
{"schema": "nbdev.devices/v1", "devices": [{
  "id": "d3f9a07c", "name": "手机", "tokenHash": "<sha256 hex>",
  "createdAt": "…", "lastUsedAt": "…", "expiresAt": "<createdAt + 90 天>",
  "revokedAt": null, "revokedBy": null,
  "pairedFrom": {"tailnetLogin": "<所有者的登录名>", "address": "100.x.y.z"}
}]}
```

- **令牌**：32 字节随机数（base64url），cookie 里是 `<设备 id>.<令牌>`；服务端按 id 找到记录，用 `timingSafeEqual` 比 `sha256(令牌)`；只存哈希。
- **有效期**（待决问题 11）：
  - 空闲 14 天滑动：`lastUsedAt` 加 14 天；
  - 绝对上限 90 天：`expiresAt`；
  - 两者取先到的。过期与吊销的设备回 401，各带码 `device_expired`、`device_revoked`；页面据此写明，并引导重新配对。
  - `lastUsedAt` 在内存里随每个请求与 WebSocket 打开更新，**最多每小时落一次盘**，免得每个请求都写文件；面板重启最多少记一小时。
  - 一分钟一次的定时器关掉绝对期限已过的设备的连接。
- **配对票据**：沿用 `panel open` 的做法，用 `panel.json` 里的启动令牌签。
  - 格式 `p1.<nonce 16 hex>.<过期时刻>.<base64url(设备名)>.<HMAC 截到 32 hex>`；
  - HMAC 的输入以 `pair.` 开头，与登录票据分开：登录票据不能当配对票据用，反过来也不行；
  - 5 分钟过期，用过的 nonce 记在内存里；面板重启后启动令牌换了，旧票据一律作废，所以内存记录就够；
  - 票据缩短到约 110 个字符：网址加票据的二维码约 45×45 个模块，80 列的终端放得下。
- **`nbdev panel pair --name <设备名> [--json]`**：
  - 前提：面板在跑、开了 tailnet 来源、审计已初始化。设备名 1 到 32 个字，不许控制字符，不能与没吊销的设备重名。
  - 调用者是 Agent 会话时拒绝（`caller_is_agent`）：票据不该进 Agent 的上下文与日志。这一条按 t07 的调用者识别判断。
  - 读 tailnet 状态，拼出 `https://<主机名>[:端口]/pair#<票据>`：票据放在 `#` 后面，不进请求行，链接预览之类的 GET 也碰不到它。
  - 打印二维码（`uqr` 的 Unicode 方块，留白四格、按深色背景反相；终端不足 60 列时只给链接）、链接与过期时刻；`--json` 只给 `url` 与 `expiresAt`。
  - 开发者是经 SSH 进来的，二维码就打在 SSH 终端里，手机扫这个码。
- **配对页** `/pair`（只在 tailnet 来源上；回环上回 404，说明“本机用 nbdev panel open”）：
  - 页面从 `location.hash` 取票据，显示设备名与“配对这台设备”按钮；
  - 点了才 `POST /api/pair {ticket}`，这个接口不要求登录，第一节的 1 到 4 与第 6 道都要过；
  - 服务端核对签名、过期、没用过与设备名没被占用，然后建设备、写审计、`Set-Cookie`，回 `{device: {id, name}}`，页面跳到首页；
  - 失败时写原因：过期、用过、面板重启过、名字被占。
- **吊销与查看**：
  - `nbdev panel devices [--json]` 列出设备：名字、id、配对与最近使用时刻、空闲期限与绝对期限、状态（有效、空闲过期、到期、已吊销）、tailnet 登录名；另列本机会话数（只在面板在跑时有）。
  - `nbdev panel devices revoke <名字或 id>` 写 `revokedAt`、`revokedBy: "cli"`，并写审计。
  - 面板里新增“设备”页：列出同样的内容，可以吊销某台，也可以退出当前这台；吊销要两步确认，`revokedBy` 是发起的设备名。
- **吊销怎么生效**：
  - 面板每次核对设备令牌之前，先 `stat` 一次设备库（比 mtime、大小、inode），变了就重读；另有目录监视加 5 秒一次的兜底。
  - 重读之后，把已吊销或已过期的设备的 `/ws` 与 `/ws/terminal` 都以 4401 关掉：终端连接走 t12 预留的 `closeLoginSession`，接管先释放，原因 `session_closed`。
  - **这台设备的下一个请求一定被拒**（场景 4）。
- **本机登录与设备的关系**：两套凭据按来源分开。
  - 回环来源只认 `panel open` 的本机会话：只在内存里，面板重启作废，与现在相同；不进设备库。审计的 `device` 仍是 `local`。
  - tailnet 来源只认设备令牌：持久，面板重启照样有效。
  - `/login?ticket=` 只在回环上有效，`/pair` 只在 tailnet 上有效。
  - 回环请求同样要登录，这一点不变：Tailscale Serve 的请求走的是 unix socket，也要设备令牌，不存在“回环免登录”的口子。

### 三、tailnet 的探测、主机名与证书

- **探测**：tailnet 来源开着时，启动时与之后每 60 秒各调一次 `tailscale status --json` 与 `tailscale serve status --json`。
  - 两个都是只读命令，单次限时 3 秒；`tailscale` 的路径先看 `NBDEV_TAILSCALE_BIN`，再找 `PATH`。
  - 取出：`BackendState`；本机的 `DNSName`（去掉末尾的点）；所有者登录名；`CertDomains`（HTTPS 开没开）；serve 配置里哪个 HTTPS 端口指向哪个 unix socket；有没有 funnel。
  - 结果放进 `/api/meta.tailnet`，由 `nbdev panel tailnet` 打印。
- **Host 白名单**（只在 tailnet 来源上，回环来源的白名单不变）：
  - 面板来源收 `<DNSName>` 与 `<DNSName>:<面板外部端口>`，产物来源收 `<DNSName>:<产物外部端口>`；
  - 主机名取最近一次成功探测的结果；探测从来没成功过就一律 421（失败关闭）；
  - 用 IP 或短名访问时 TLS 证书对不上，浏览器自己就挡住了。
- **外部端口**：缺省面板 443、产物 8443，用 `panel serve --tailnet-port`、`--tailnet-artifact-port` 改。
  - 面板拿 serve 配置核对：配置里这两个端口没指向自己的两个 socket 时，在 `/api/meta` 与 `nbdev panel tailnet` 里警告，照旧按参数算产物来源的地址；
  - 不从 serve 配置反推端口：Tailscale 改了 JSON 的格式时，只是核对失效，不会把地址算错。
- **证书**：serve 自己申请并续期 Let's Encrypt 证书，面板不碰证书。
  - 打开 HTTPS 证书会把 `<本机>.<tailnet>.ts.net` 写进公开的证书透明日志：主机名会公开，服务不会。这一点写进开发者步骤。
- **主机名变了**（改机器名、tailnet 改 DNS 名）：
  - 下一次探测就换白名单；
  - 已配对设备的 cookie 绑在旧主机名上（`__Host-`），浏览器不会再发，设备要重新配对；
  - 旧记录留在设备库里，14 天后空闲过期，也可以 `devices revoke`。
  - 证书由 serve 按新名字重新申请。`nbdev panel tailnet` 会提示“主机名与上次不同”：面板在设备库旁记下上次的主机名。
- **`nbdev panel tailnet [--json]`**：检查命令，只读，不改任何配置。
  - 打印 Tailscale 版本、运行状态、主机名、HTTPS 证书开没开、operator 有没有设、现在的 serve 配置、有没有 funnel、面板的两个 socket 路径；
  - 打印**开发者要执行的配置命令**（带上实际的 socket 路径与端口），以及配置之后的核对结论：两个端口是否都指向本面板、是否只在 tailnet 内。

### 四、配对上线之前关门，与平稳过渡

- 回环 TCP 来源**永远**拒绝转发头，t13 不放开。现在 `docs/panel.md` 写的“跨设备上线之前不接受”改成“回环来源不接受，Tailscale 只能转发到 unix socket”。
- tailnet 来源默认关，只有 `panel serve --tailnet` 才开；`install-service` 加 `--tailnet`，写进单元的 `ExecStart`。
- 要暴露出去，必须同时有三样：开发者用 sudo 配了 serve、面板开了 `--tailnet`、设备配过对。
- 各种错配都失败关闭：

| 错配 | 结果 |
|---|---|
| serve 指到 `127.0.0.1:4400` | 转发头被拒，403 |
| serve 指到 socket，但面板没开 `--tailnet` | socket 不存在，serve 回 502 |
| 开了 funnel | 503 |
| tailnet 里别人的设备 | 登录名不符，403 |
| 本机设备没配对 | 只能看到配对页 |

- **场景 6**：`panel serve --host 0.0.0.0` 以及任何非回环地址，照旧报 `unsafe_host`（退出码 2）；`--tailnet` 不接受 TCP 地址，tailnet 来源只能是 unix socket。`install-service` 没有 `--host`，生成的单元只会绑回环。

### 五、审计

- **写入类动作带上设备**：`AuditEntry` 的 `device` 是设备名（本机会话是 `local`），新增 `deviceId`（本机为 null）与 `tailnetLogin`（tailnet 来源才有）。
  - 涉及：写仓库的五种、`prompt`、`keys`、`takeover`、`release`。
  - 方法：把 `PANEL_DEVELOPER` 常量换成每个请求解析出的调用者 `DeveloperCaller {kind, device, deviceId}`，经 `writes.ts`、`session-io.ts`、`TerminalHub` 的连接往下传。
  - 自动通知不是某台设备发起的，`device` 记 `panel`。手动发送记发起的设备。
- **新动作**：
  - `pair`：一行结果，含设备 id、名字、tailnet 登录名、来源地址；失败也写，写原因，不写票据。
  - `revoke`：一行结果，含设备 id、名字、`by`（`cli` 或发起的设备名）。
  - 过期不写。
  - 命令行的 `revoke` 也追加审计：它是面板之外的第二个写者，每行一次 `O_APPEND` 追加，Linux 本地文件系统上一行不会被拆开。这一点写进文档。
- **答复的 `submittedBy.device` 会进 Git**：t10 起答复记录入库，以后会是“手机”这样的设备名。配对说明里提醒：设备名不要写个人信息。

### 六、手机布局

t09 到 t12 的页面已在 390 宽验过，t13 新增或改动：

- **配对页**：设备名、一个按钮、失败原因，390 与 1440 都验。
- **没登录的提示分两种**：
  - tailnet 上：“这台设备没配对（或已吊销、已过期）：在电脑上运行 `nbdev panel pair --name …`，用手机扫码”；
  - 回环上：照旧提示 `panel open`。
- **设备页**：390 宽时是卡片列表，吊销按钮两步确认。
- **顶栏**：tailnet 来源上显示当前设备名，点了去设备页。
- **真实手机**（Android Chrome，经 Serve 的 https 与 wss）只在开发者那一步验。

### 七、SSH 转发与跨设备的关系

- **t13 之后 SSH 转发照常能用，方法不变**：
  - 转发 `ssh -L 4400:127.0.0.1:4400 -L 4401:127.0.0.1:4401 <这台机器>`，再 `nbdev panel open --print`；
  - 走的是回环来源，用本机会话，审计里是 `local`，面板重启后要重开。
  - 不要把 SSH 转发指到 unix socket：没有 Tailscale 的头，会被 tailnet 来源拒绝。
- **两者的分工**：
  - SSH 转发：临时的、在电脑上用、不留凭据；
  - Tailscale：手机这种不方便开 SSH 隧道的设备，配一次对用 14 到 90 天。
- 两者可以同时用，互不影响。

## 切片

每片在集成分支上单独提交，只按路径暂存，提交前 `git diff --cached --check`；每片自跑包的 `test`、`typecheck`、`build:web`。

| 切片 | 内容 | 测试 |
|---|---|---|
| S1 设备库与配对票据 | `src/server/devices.ts`：库、锁、哈希、有效期、`lastUsedAt` 节流落盘、重读与变更回调。`auth.ts`：配对票据，与登录票据分开签。命令行 `panel pair`（依赖 `uqr` 0.1.3，精确版本）与 `panel devices [revoke]`。审计加 `pair`、`revoke` 与 `deviceId`、`tailnetLogin` 字段。新错误码 `device_not_found`、`device_name_taken`、`pairing_unavailable`、`caller_is_agent` | L1：票据、有效期、令牌比对、库的读写与锁。L3：命令行在临时根下配对、列出、吊销、写审计 |
| S2 tailnet 来源 | tailnet 探测，可注入，测试用假的；两个 unix socket 监听；第一节的校验；按来源解析出凭据；`/api/pair`；吊销与过期时关 `/ws`、`/ws/terminal`；每个请求的调用者写进审计（写入、文字、按键、接管）；`panel serve --tailnet [--tailnet-port] [--tailnet-artifact-port]`；`install-service --tailnet`；`nbdev panel tailnet` | L3：`tests/panel-tailnet.test.ts`，经 unix socket 发请求，用伪造的头、Host、Origin，见“验收” |
| S2a 连通性核对（开发者在场） | 在临时仓库上用集成分支的代码前台起 `panel serve --tailnet`，端口避开 4400、4401；开发者用 sudo 把 9443、9444 两个端口临时指到它的 socket；手机打开配对页、配对、看一页；核对完开发者撤掉这两个端口。目的是在写前端之前，确认第一节依赖的四个未实测行为（见“风险”第 2 条） | 记录观察；不对就回到 S2 改 |
| S3 前端 | 配对页、两种没登录的提示、设备页、顶栏的设备名；`/ws` 被以 4401 关闭时显示原因 | 浏览器：本地 TLS 代理扮 Tailscale Serve（见“验收”），390 与 1440 |
| S4 文档 | `docs/panel.md`：来源与登录改写，新增“从别的设备用（Tailscale Serve）”与“设备”；`docs/file-formats.md`：`devices.json`、审计的新字段与动作；`docs/cli.md`：`panel pair`、`panel devices`、`panel tailnet`、错误码 | `governance:check`、`docs:check` |
| S5 验收 | L3 全量；浏览器；开发者用手机走场景 5 | 见下 |

## 接口与数据

```text
nbdev panel serve [--host 127.0.0.1] [--port 4400] [--artifact-port 4401] [--tailnet [--tailnet-port 443] [--tailnet-artifact-port 8443]] [--no-build | --static-dir <目录>]
nbdev panel pair --name <设备名> [--json]          # 面板在跑且开了 tailnet；调用者是 Agent 会话时拒绝
nbdev panel devices [--json]                        # 列出设备
nbdev panel devices revoke <名字或 id> [--json]
nbdev panel tailnet [--json]                        # 只读检查；打印开发者要执行的配置命令

tailnet 来源（unix socket，经 Tailscale Serve）
  GET  /pair                      配对页（静态页面，单页路由）
  POST /api/pair {ticket}         不要求登录；Origin、Sec-Fetch-Site、CSRF、Tailscale 登录名都要过 → Set-Cookie
  GET  /api/devices               设备页（要设备令牌）
  POST /api/devices/:id/revoke    吊销；对自己的 id 就是“退出这台设备”
  其余接口与回环来源相同，凭据换成设备令牌
回环来源：不变；/pair 回 404
GET /api/meta 加 tailnet: {enabled, state, host, ports: {panel, artifact}, serve: {matches, funnel}, reason} 与 viewer: {kind: "local" | "device", name}
401 的 code：unauthorized（回环）、device_unpaired、device_expired、device_revoked（tailnet）
WebSocket 关闭码：4401 用到 /ws（吊销、过期），/ws/terminal 已有
```

- 新错误码（退出码）：`device_not_found`（5）、`device_name_taken`（3）、`pairing_unavailable`（3：审计没初始化、面板没开 tailnet 或没在跑）、`caller_is_agent`（2）、`tailnet_unavailable`（1：`tailscale` 读不到）。
- 审计：`action` 加 `pair`、`revoke`；每行加 `deviceId`、`tailnetLogin`（可选）。
- 核心库：`DeveloperCaller` 加 `deviceId`；`src/index.ts` 不导出新东西。

## 验收场景与测法

不改 Tailscale 配置，不碰常驻面板。L3 与浏览器都在临时仓库上，设备库与审计在临时根的 `XDG_CONFIG_HOME` 下，socket 在临时根下。

| 场景 | 测法 |
|---|---|
| 1 未配对的设备经 tailnet 打开面板：只看到配对页 | **L3**：经 tailnet 的 unix socket，带上所有者登录名与 `X-Forwarded-Proto: https`，没有 cookie：`/` 回首页的 HTML；`/api/overview`、`/api/meta` 回 401 `device_unpaired`；`/ws` 与 `/ws/terminal` 的升级回 401；产物来源不带前缀回 404。**浏览器**：页面显示“这台设备没配对”，没有任何记录数据 |
| 2 配对码 5 分钟后失效，用过一次也失效 | **L3**：按 6 分钟前签的票据回 403 `pair_expired`；同一张票据第二次回 403 `pair_used`；面板重启（换启动令牌）之后旧票据回 403；登录票据当配对票据用、配对票据当登录票据用都回 403；登录名不是所有者回 403；回环来源上的 `/api/pair` 回 404。审计里成功与失败各有一行，没有票据 |
| 3（作废） | 开发者 2026-10-13 定不分级。测法改成：配对设备能答复、写仓库、接管终端，与本机会话一样（L3 各一条） |
| 4 吊销某台设备后，它的下一次请求被拒 | **L3**：设备开着 `/ws` 与一条接管中的 `/ws/terminal` 时，子进程运行 `nbdev panel devices revoke 手机`：3 秒内两条连接都以 4401 关闭，终端释放、原因 `session_closed`、尺寸改回；下一个请求 401 `device_revoked`；审计里有 `revoke`（`by: cli`）。另测：在设备页上吊销自己；空闲 14 天与 90 天到期（注入时钟），到期回 401 `device_expired` |
| 5 在手机上打开一份产物（产物来源经 tailnet 的第二个端口）、答一道题，通知送达会话 | **开发者参与**，步骤见下 |
| 6 把面板配置成绑 `0.0.0.0`：拒绝启动 | **L3**：`panel serve --host 0.0.0.0`、`--host <本机的 tailnet 地址>` 都以 2 退出（`unsafe_host`），没有监听（`install-service` 没有 `--host`，不另测）。另测：socket 目录权限宽于 700 时 tailnet 来源不开，`/api/meta` 写原因 |
| 回环来源不放松 | **L3**：回环来源带上 `Tailscale-User-Login: <所有者>` 与 `X-Forwarded-*`，仍回 403 `forwarded`。这正是“本机其它账户伪造头”的情形 |
| tailnet 来源的其它校验 | **L3**：Host 不在白名单回 421；探测从没成功过时一律 421；没有 `X-Forwarded-Proto` 回 403；带 `Tailscale-Funnel-Request` 回 403；探测到 funnel 回 503；写请求的 Origin 是 `http://…` 或别的主机回 403；`Set-Cookie` 有 `__Host-` 前缀、`Secure`、`HttpOnly`、`SameSite=Strict`；CSP 里是 `wss://` 与 `https://<主机名>:<产物端口>` |
| 审计带设备 | **L3**：手机答一道题、发一段文字、接管一次：每行的 `device` 是设备名，`deviceId` 对得上；本机会话仍是 `local`；自动通知是 `panel` |
| 二维码 | **L1**：终端不足 60 列时只给链接、`--json` 不带二维码；二维码的内容交给 `uqr`，不另做解码测试，真实扫码在开发者那一步 |

**浏览器**（临时仓库）：浏览器连不上 unix socket，所以写一个本地 TLS 代理扮 Tailscale Serve，放在 `tests/` 里，L3 也用它测 wss：

- 代理是 Bun 起的 HTTPS 服务，用自签证书，监听 `127.0.0.1:9443` 与 `9444`；转发到面板的两个 socket，并按 Tailscale 的做法删掉、再填上身份头与 `X-Forwarded-*`。
- Chrome 用 `--host-resolver-rules=MAP dev.example.ts.net 127.0.0.1` 与 `ignoreHTTPSErrors` 打开 `https://dev.example.ts.net:9443`。
- 走一遍：没配对时的配对页 → 用 `panel pair` 的网址配对 → 首页 → 产物页，iframe 来自 `:9444`，答一题 → 设备页退出这台设备 → 回到配对页。
- 截图：390 与 1440 两种宽度，明暗两套。

**开发者在场的那一步**（场景 5；t13 合入 master 之后，S2a 已经核对过连通性）：

1. **在 Tailscale 管理后台打开 HTTPS 证书**：DNS 页的 HTTPS Certificates，MagicDNS 已经开着。知情：主机名 `<本机>.<tailnet>.ts.net` 会进公开的证书透明日志。
2. **重装常驻服务，带上 `--tailnet`**：`bun run --cwd packages/dev-panel install-service -- --tailnet --force`。如果另一个分支的 `service` 包脚本先合入，以它的写法为准。
3. **运行 `nbdev panel tailnet`**：看它打印的两个 socket 路径与配置命令。
4. **配置 serve，用 sudo，不设 operator**（见决定点 8）：
   ```bash
   sudo tailscale serve --bg --https=443  unix:/run/user/1000/nbdev/neuro-book-<哈希>/panel.sock
   sudo tailscale serve --bg --https=8443 unix:/run/user/1000/nbdev/neuro-book-<哈希>/artifact.sock
   ```
5. **核对**：
   - `tailscale serve status` 应列出两个 `https://<本机>.<tailnet>.ts.net`（`:8443`）条目，标 tailnet only；
   - `tailscale funnel status` 不应有任何条目；
   - 再跑一次 `nbdev panel tailnet`，结论应是“两个端口都指向本面板、没有 funnel”。
6. **手机先不配对**：手机开着 Tailscale，打开 `https://<本机>.<tailnet>.ts.net`，应看到“这台设备没配对”，这是真实环境下的场景 1。
7. **配对**：在 SSH 会话里运行 `nbdev panel pair --name 手机`，用手机扫终端里的二维码，在配对页点“配对这台设备”，应进入首页。
8. **答题并核对通知**：主 Agent 事先在 t13 下发一份只有一道题的提问集，提问者是主 Agent 自己的会话。开发者在手机上打开它（产物 iframe 来自 `:8443`）并答题；主 Agent 的会话应收到 `[nbdev]` 通知，读答复、确认，并核对审计里这次答复的 `device` 是“手机”。
9. **可选，核对吊销**：在电脑上 `nbdev panel devices revoke 手机`，手机刷新应回到配对页；要继续用就再配一次。
10. **要撤掉时**：`sudo tailscale serve reset`（清掉本机全部 serve 配置；现在本机没有别的 serve 配置）。只撤一个端口的写法（`--https=443 off`）来自 Tailscale 的文档，1.102.4 的帮助里没有写，实施时以 `nbdev panel tailnet` 打印的命令为准。

## 决定点

| # | 问题 | 推荐 |
|---|---|---|
| 1 | 面板怎么认出“经 Tailscale 来的请求” | Tailscale Serve 只转发到面板的两个 unix socket（目录 700、socket 600）；回环 TCP 来源照旧拒绝转发头。不在同一个 TCP 端口上看头：本机其它账户能伪造（已实测）；也不另开回环 TCP 端口：同样谁都连得上 |
| 2 | “只看”这一级留不留口子 | 不留字段，不做分级的代码。口子是现有的结构：写请求都经 `handlePanel` 的非 GET 分支，终端的写入都经 `TerminalHub` 的 `takeover`、`input`、`key`，以后加分级只改这两处，设备库的 `schema` 升一版加 `tier`。现在留一个永远是“可操作”的字段，只会让人以为它起作用 |
| 3 | 配对码的形式 | 签名票据放在网址的 `#` 后面，配二维码与可复制的链接；不做可手打的短码（短码要防爆破、要存状态） |
| 4 | 有效期 | 空闲 14 天滑动、绝对上限 90 天（待决问题 11）；`lastUsedAt` 最多每小时落一次盘 |
| 5 | 吊销怎么生效 | 每次核对令牌前比对设备库的变化，另有监视加 5 秒兜底；已开的 `/ws`、`/ws/terminal` 以 4401 关闭，接管先释放 |
| 6 | 本机登录与设备 | 两套凭据按来源分开：回环只认 `panel open` 的本机会话（内存里，重启作废，不进设备库），tailnet 只认设备令牌 |
| 7 | tailnet 里别人的设备 | 只放行与本机节点同一个所有者的 `Tailscale-User-Login`（tailnet 里现有两台别人的设备）；可配置的名单推迟 |
| 8 | operator | **不设** `--operator=notnotype`，serve 的命令用 sudo（配置会保留，配一次就行）。设了 operator，开发者名下的所有进程（包括 Agent）不用 sudo 就能改 serve，甚至打开 funnel |
| 9 | tailnet 来源默认开不开 | 默认关，`panel serve --tailnet` 打开，`install-service --tailnet` 写进单元 |
| 10 | 外部端口 | 面板 443、产物 8443，用参数改；面板读 serve 配置只做核对，不反推 |
| 11 | 二维码库 | `uqr` 0.1.3，精确版本，零依赖 |
| 12 | 面板里要不要设备页 | 要：列出、吊销、退出这台设备。丢了手机时能在电脑的浏览器里吊销 |
| 13 | 自动通知在审计里算谁 | `device: "panel"`；手动发送算发起的设备 |
| 14 | `panel pair` 能不能由 Agent 调 | 不能（`caller_is_agent`）：票据不该进 Agent 的上下文与日志 |
| 15 | 配对失败写不写审计 | 写，写原因，不写票据；票据猜不到，不限速 |

## 与 Proposal、实施计划的不一致

1. **不分级**（开发者 2026-10-13）：Proposal 第八节第 3、4 条与待决问题 11 的“缺省只看”、实施计划的场景 3 作废；`panel pair` 没有 `--tier`。
2. **转发来的请求不“来自回环”**：Proposal 第八节第 3 条写“Tailscale Serve 转发来的请求在面板看来也来自回环”。本计划让它转发到 unix socket，与回环 TCP 来源分开，理由见决定点 1。
3. **不去掉对转发头的拒绝**：实施计划的范围写“去掉对转发头的拒绝”。本计划在回环来源上保留它，转发头只在 tailnet 来源上收。
4. **多一道 tailnet 登录名核对**（决定点 7）：Proposal 写“只有自己 tailnet 里的设备能连”，实测 tailnet 里有别人的设备。
5. **配对码不进请求行**：Proposal 写“打印一次性码与二维码”。本计划的“码”是放在 `#` 后面的签名票据，不做短码（决定点 3）。
6. **多一个检查命令 `nbdev panel tailnet`**，多一个依赖 `uqr`。
7. **审计多两个字段** `deviceId`、`tailnetLogin`；自动通知的设备记 `panel`。

## 风险

按影响排序，前两条是我认为最大的两处。

1. **tailnet 不等于“只有我的设备”**：
   - 起因：tailnet 里有另外两个人的设备，ACL 按缺省的全通处理；serve 一配好，它们就能连到面板的 443 与 8443。配错还可能开出 funnel（公网）。
   - 最坏的情况：别人的设备拿到面板，等于拿到这台机器的 shell（终端接管）。
   - 缓解：
     - 设备配对是真正的门，配对票据只出现在开发者的终端里；
     - 只放行所有者的 Tailscale 登录名；
     - 产物来源仍靠每次启动重新生成的随机前缀；
     - 探测到 funnel 就 503，带 funnel 头的请求一律 403；
     - 不设 operator，Agent 改不了 serve 与 funnel。
   - 剩下的：配对好的手机丢了，在电脑上吊销；令牌最长空闲 14 天。另外可以建议开发者在 ACL 里把本机的 443、8443 只放给自己。这一条不在 t13 内，写进开发者步骤，作为可选。
2. **unix socket 这条路依赖四个没在本机实测的行为**：
   1. tailscaled 转发前删掉客户端自带的 `Tailscale-User-Login`；
   2. serve 转发到 `unix:` 目标时 WebSocket 升级能通；
   3. 转发时 `Host` 保持原样；
   4. 带 `X-Forwarded-Proto: https`。
   - 这几条来自上游源码与帮助文本，验证就要改 serve 配置，不在我的权限内。
   - 万一不成立：第 1 条只削弱第二道门（设备配对仍在）；第 2 条会让终端与推送在手机上不可用；第 3、4 条要改用 `X-Forwarded-Host` 或放宽这道核对，只限 tailnet 来源。
   - 缓解：S2 之后加一步开发者在场的连通性核对（S2a），在写前端之前就发现。
3. **设备库有两个写者**（面板与命令行）：用目录锁加原子改名；`lastUsedAt` 节流落盘。
4. **主机名或证书变化**：设备要重新配对；`nbdev panel tailnet` 提示；HTTPS 证书让主机名进公开日志（知情）。
5. **启动令牌在 `.local/agent/panel.json`**：开发者名下的进程（含 Agent）能签配对票据，与现在能签登录票据相同。缓解是 `caller_is_agent` 与所有者登录名核对；同一用户的进程本来就不在这道门要防的范围里。
6. **Agent 不能实测真实的 serve**：只有开发者那一步与 S2a 能验证。L3 与浏览器用的是扮 Tailscale 的代理，按上游行为写成。

## 需要开发者批准或参与

| 事项 | 时机 | 性质 |
|---|---|---|
| 决定点 1、2、7、8、9：unix socket、不留分级字段、只放行所有者、不设 operator、默认关 | 实施前 | 安全与范围的取舍，按推荐先定，待确认 |
| 在 Tailscale 管理后台打开 HTTPS 证书（主机名进证书透明日志） | S2a 之前 | 改变网络配置，开发者执行 |
| S2a 连通性核对：用 sudo 临时配两个端口（9443、9444）指到临时面板，用手机打开一次，然后撤掉 | S2 之后 | 改变网络暴露面，开发者执行并参与 |
| 合入后重装常驻服务（带 `--tailnet`）、用 sudo 配 serve 的 443 与 8443、用手机走场景 5 | 合入后 | 开发者执行并参与 |
| 可选：在 ACL 里把本机的 443、8443 只放给自己 | 任意时候 | 开发者决定 |

依赖安装（`uqr`）、本地提交、临时仓库里的测试，都属于本地可逆操作，按 P-005 不再逐项询问。

## 推迟（不在 t13）

- 分级（“只看”与“可操作”）；
- 可配置的 Tailscale 登录名名单；
- 设备改名；
- 面板自带 TLS 的局域网直连；funnel；
- 设备页上的“本机会话”管理（本机会话在面板重启时作废，不另做吊销）；
- 用 Tailscale 的 app capabilities（`--accept-app-caps`）做授权。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交设计审查。计划前的查询都是只读（`tailscale version`、`status --json`、`serve status`、`debug prefs`、`systemctl cat tailscaled`、tailscaled 二进制里的字符串）；伪造头的演示在会话临时目录里起了一个回显服务，用完已关。没有改任何 Tailscale 配置，没有残留进程。
