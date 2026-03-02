# Agent v3 测试策略

## 原则

- v3 初期目标是覆盖新增行为的核心路径。
- 测试优先覆盖对象边界和协作关系，而不是复制 v2 的实现细节。
- 模型测试允许真实调用 `deepseek/deepseek-v4-flash`。
- 运行时测试可以用 mock NeuroAgent stream，也可以用真实 DeepSeek 模型 smoke。

## 当前测试范围

- Model provider：真实模型返回正文、thinking/reasoning、usage。
- Tool registry：注册、解析、未知 tool。
- Execute shell：成功、目录限制、截断、超时。
- Runtime：消费流事件，产出 thinking、assistant delta、tool、usage、done。

## 后续扩展

- watched variable baseline。
- tool call / tool result 消息。
- request_user_input 状态机。
- conversation tree 与分支操作。
- NeuroAgent 事件消费与 SSE adapter。
