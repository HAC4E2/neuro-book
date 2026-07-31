# ADR 0009：Product Runtime Image 生成与消费

- 状态：Accepted
- 日期：2026-07-29
- 关联任务：[Task 130](../tasks/130-desktop-application-foundation/README.md)、[Task 105](../tasks/105-unified-installation-manager/README.md)、[Task 117](../tasks/117-windows-process-tree-lifecycle/README.md)

## 背景

NeuroBook 的发行物同时保留完整 Source、本地重建能力和一个可直接运行的 Product。旧构建把 Nitro 生成目录和依赖闭包直接当成 Product：普通前端资源字符串会形成假 Seed，真实 Bun/pnpm external 又携带构建机物理路径；命令分别 bundle，动态依赖、Profile 编译依赖、原生文件和发布调用方也没有唯一合同。

Manager 已拥有安装锁、Operation Journal、migration、健康检查、切换和恢复。如果 Runtime Image Builder 也切换 current 或维护 rollback，同一路径会出现两个激活 owner。反过来，如果发布链只检查 `server/index.mjs`，半成品也会被归档。

## 决策

1. `ProductRuntimeImageBuilder` 只负责在隔离 staging 中构建并验证 ready candidate。公开写接口是 `buildCandidate()`，完整读接口是 `openVerified()`；它不切换 current、不管理安装锁、Operation Journal 或 rollback。
2. Manager 是受管 Installation Root 中唯一的 Product 激活者。它继续拥有 install/update/adopt 的 staging、migration、健康提交点、切换与恢复。
3. 非受管 Source checkout 使用窄的 `LocalProductPublisher` 原子更新本地 `.output`。检测到受管 installation manifest 时，publisher 拒绝绕过 Manager。设置 `NEURO_BOOK_OUTPUT_DIR` 时只向调用方给定的空 staging root 发布 ready candidate。
4. Runtime Image 只有在以下证据一致时才 ready：Source identity、lockfile、平台、Runtime 版本、Product Runtime Contract 摘要、owner inventory、tree digest、shape digest、manifest 与最后写入的 ready marker。构建期间 Source 变化直接失败。
5. Release、Windows Portable、Docker、staging、Manager doctor/import/install/update 和 smoke 只能消费 `openVerified()` 成功且 Source identity 匹配的镜像。单独存在 `server/index.mjs` 不构成可执行或可归档条件。
6. 状态展示和实例发现可以使用 `openControlPlane()`，但它只验证 manifest/ready/contract 控制文件及合同入口存在性，返回独立只读类型；执行、激活、安装和归档禁止使用该结果。实测完整验证冷启动约 13.3 秒、热缓存约 1.08 秒，轻量验证约 4-9 毫秒。
7. Product Runtime Contract 是所有消费者唯一的逻辑入口。正式命令为 `start`、`migrate-database`、`migrate-application-state`、`create-admin`、`profile`、`variable`、`workspace`；发布检查和内部步骤同样按登记 ID 解析。未知 schema、未知 ID、路径逃逸、缺失入口或不允许的附加参数立即失败，不保留 `server/scripts` fallback。
8. Nitro 只根据真实 ESM module specifier 发现 external Seed；普通字符串、注释、source map 和客户端资源清单不形成 Seed。绝对 file URL、Bun `.bun` 和 pnpm `.pnpm` 路径统一规范化到 Product 内部，物理包与根 hoisted 包版本不一致时失败。
9. 最终 Nitro server 使用单 bundle；命令使用一次多入口构建和 shared chunks；Profile 编译使用与 Product revision 绑定的 Authoring Kit；native addon、动态 package、worker、`createRequire` 与必须读取 package 形状的依赖进入显式 package islands。命令入口必须由 Bun metafile 的 `entryPoint` 建立映射，不能从输出文件名反推。
10. `native-islands.json` 使用 v2 合同登记无法静态解析的 dynamic import：每项必须包含 Product 相对路径模式、精确数量、保留原因和对应 smoke。最终闭包扫描 `server/index.mjs`、commands、Authoring Kit 与 `server/assets/**/*.mjs`；未登记、重复命中、数量漂移或逃逸镜像的引用全部失败。
11. raw chunk 中 Nitro 的 `file:///_entry.js` fallback 在最终 bundle 阶段统一替换为 `import.meta.url`。不得按 raw chunk 位置提前计算相对入口，因为 chunk 合并后该位置不再成立。
12. Profile 普通 authoring 只允许 `nbook/profile-sdk` 及显式登记依赖。`compilerPackageRoot` 固定为 Product `server/authoring/package.json`，`artifactRuntimeRequireRoot` 固定为最终 `server/index.mjs`；编译不得向上借用 Source Root 或根 `node_modules`。
13. Authoring Kit 对每个依赖登记 name、version、用途、投影类型和 smoke。`typebox` 同时携带 implementation 与声明；`@types/node`、`undici-types` 只作为声明。当前 Pi/Provider、Prisma 与 Zod 声明是 SDK 公开类型的传递依赖，不能假装为可删除的偶然文件。
14. 每个平台保存真实 owner baseline。全局 6000 文件、360 MiB 是绝对安全上限；日常回归门禁按每个 owner 的已审查基线上浮最多 10%，不能把全局上限复制成每个 owner 的假基线。
15. Runtime Image 不携带 VitePress `dist/cache`、raw Nitro chunks、完整 docs 或完整 Source 副本。完整 Release Source 是独立 owner，继续展开随发行交付，并可恢复 Git remote、安装开发依赖和本地重建。
16. Product 构建使用显式环境投影与 tracked `.env.product`：只透传进程启动、动态库和临时目录所需的 OS 变量，固定 production、node-server、UTC/C locale、关闭 devtools 与 telemetry。宿主 `.env`、`NUXT_*`、`NITRO_*`、`VITE_*` 和运行期 Secret 不能改变同一 Source identity 的 payload。
17. 整个 prepare、Nuxt raw build、Product 后处理和 publish pipeline 使用全局 fail-fast build lease，保护共享 `.nuxt` 与生成源码。candidate 另有 operation lease；成功后删除 marker，下一次构建回收没有 candidate 且没有活跃锁的孤立 marker，超过 24 小时的失活 candidate 才可回收。
18. Source digest 只由平台、revision、dirty 布尔值和真实 Source 文件内容构成；branch、upstream、ahead/behind 和 index/unstaged 表示方式只用于诊断，不进入身份。Nitro 资源排序使用固定 code-unit 顺序，不依赖宿主 locale。
19. Release 读取本地 `.output` 时与 Publisher 共用 lease，归档完成前禁止切换代次；Release manifest/checksum 在解析输入归档前先拒绝已有目标，外部命令输出等到 stdio close 后才可消费。

## 原因

候选生成、安装激活和本地发布是三个不同事务。分开 owner 后，Builder 可以严格验证不可变镜像，Manager 可以继续使用现有恢复协议，本地 checkout 也保留开发体验。逻辑命令合同让 Manager、Docker 和 Release 不再知道 bundle 内部文件名。

bundle 与 package islands 的组合符合 NeuroBook 的真实能力：大部分 TS/JS 可以合并减少重复和文件数，Sharp、sqlite-vec、Prisma、动态 Profile 编译等仍保留真实文件系统形状。为独立 Bun Product 自造 ASAR 虚拟文件系统会扩大所有读取方的复杂度，不采用。

## 后果

- 构建比普通 `nuxt build` 多一次 Source 锁定、owner 盘点和全树摘要，但发布证据可复现，半成品不能进入发行链。
- status/discovery 只展示控制面可信度；任何会运行代码的操作仍支付完整 payload 验证成本。
- Authoring Kit 不是任意 npm 开发环境。新增 Profile authoring import 必须先登记用途、投影和 smoke。
- Windows x64 已审查基线为 4,683 个文件、161,274,231 bytes；连续五次同源 dirty 本地验证构建必须保持 payload identity 与逐 owner inventory 完全一致。dirty 证据只证明可重复性，正式 Release 仍必须在 clean runner fail closed。
- Linux 与 macOS 尚无实机 owner baseline，当前构建会 fail closed，不能借用 Windows 数字。
- 完整 Source、Tool Pack 和 Runtime Image 必须分别统计。联网 Desktop 可按需下载 Git/Bash Tool Pack；严格离线 Portable 单独承担工具文件预算。

## 未采用方案

- Builder 同时激活 `.output` 并维护 rollback：与 Manager 形成双 owner。
- 继续递归复制 production `node_modules`：文件数、假 Seed 和跨平台二进制不可控。
- 只检查 `server/index.mjs`：无法证明合同、身份、平台与 payload 完整。
- 将完整 Product 编译为单 EXE：当前动态 Profile、native extension、worker 和 package-shaped dependency 不支持这一约束。
- 为 Bun Product 实现 ASAR 类读取层：收益不足以覆盖所有动态读取、spawn、mmap 和 native addon 的新协议。
