# NovelAI Provider 可发现性调整（2026-07-22）

## 用户反馈

文生图分页内找不到 NovelAI API token 输入入口。

## 根因

`NovelAI Provider / API` 卡片位于“生成请求”和默认展开的 Danbooru Tag 索引之后。Tag 索引的内容较高，导致 API token 输入框通常落在侧栏首屏以外。

## 调整

- 将 `NovelAI Provider / API` 移至文生图面板滚动区的首个卡片。
- 将 Danbooru Tag 索引改为默认折叠。
- 不改动 Provider singleton API、服务端加密凭证、保存、连接测试或生成请求链路。

## 验证

- RED：`bunx vitest run server/text-to-image/novelai-provider-discoverability-ui-contract.test.ts` 确认旧顺序不符合要求。
- GREEN：同一命令通过，`1 file / 1 test passed`。
- 本轮按约束未进行浏览器验证。
