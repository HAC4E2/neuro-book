# Docker Compose Deployment

## User Request

- 为项目设计并实现 Docker Compose 单机生产部署方案。
- 真实 `config.yaml` 已包含模型 Provider token，需要从 Git 跟踪中移除并改成模板化配置。

## Goal

- 提供默认 `app + postgres` 的单机生产 Compose 部署。
- 保持 workspace、Postgres 数据、运行配置可持久化。
- 保持 `config.yaml` 作为应用可写的 Provider 配置真值源。
- 阻止真实 `config.yaml` 后续继续提交。

## Current State

- 项目是 Nuxt/Bun + Prisma/Postgres 应用，运行时需要 `DATABASE_URL`。
- 文件化小说 workspace 位于 `workspace/`，应作为运行数据挂载。
- Redis 只在示例环境变量和依赖中出现，当前不作为部署硬依赖。

## Walkthrough

- 新增生产 `Dockerfile`，多阶段安装依赖、生成 Prisma client、构建 Nuxt，并在运行阶段启动 Nitro。
- 新增 `docker-compose.yml`，默认启动 app 与 Postgres，Postgres 使用健康检查和数据卷。
- 新增 `docker-compose.external-db.yml`，用于外部数据库部署时关闭 app 对内置 Postgres 的依赖。
- 新增 `.env.docker.example` 和 `config.example.yaml`，`.env.docker` 只承载端口和数据库配置，真实模型 Provider 密钥由挂载的 `config.yaml` 承载。
- 增加配置文本环境变量展开工具，并接入 v2 `loadAppConfig` 和 v3 `readRawAgentConfig`。
- 执行 `git rm --cached config.yaml`，本地文件保留，仓库只跟踪模板。
- 运行镜像显式携带 Prisma 生成客户端，并使用 POSIX `sh` 启动脚本，降低基础镜像 shell 差异风险。

## Decisions

- Redis 暂不加入 Compose 默认服务。
- `config.yaml` 是运行时可写配置文件；设置页可以动态添加或更新 Provider，真实 key 直接写入该文件。
- 已提交过的 token 视为泄露，需要用户轮换；清理 Git 历史不在本次默认改动内。

## Files Changed

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.external-db.yml`
- `.dockerignore`
- `.env.docker.example`
- `config.example.yaml`
- `scripts/docker-entrypoint.sh`
- `server/utils/env-template.ts`
- `server/utils/env-template.test.ts`
- `server/utils/app-config.ts`
- `server/utils/app-config.test.ts`
- `server/agent-v3/model-provider/config.ts`
- `README.md`
- `PROJECT-STATUS.md`

## Verification

- `bun run test server/utils/env-template.test.ts server/utils/app-config.test.ts`
- `bun run typecheck`
- `docker compose --env-file .env.docker.example config` 未执行成功：当前环境没有 Docker CLI。

## TODO / Follow-ups

- 在有 Docker 的机器上执行 Compose config/build/up 验证。
- 轮换所有曾出现在历史 `config.yaml` 中的模型 Provider token。
- 如需彻底移除历史泄露内容，单独规划 Git history rewrite。
