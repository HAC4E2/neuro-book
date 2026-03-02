# Agent v3 架构草图

## 分层

```text
AgentRunner
├─ neuro-agent/createAgent
├─ model-provider
├─ AgentToolRegistry
└─ AgentRunMemory
```

## 核心对象

### Model Provider

Model Provider 读取 `config.yaml` 中的 `deepseek/deepseek-v4-flash`，构造一个真实可用的 NeuroAgent `DeepSeekChatModel`。当前硬编码模型，不做 profile/thread override。

### NeuroAgent

NeuroAgent 是 v3 自研小框架，包含 Message、ChatModel、OpenAI-compatible provider、`createAgent()` 和 SSE adapter。它不依赖 LangChain/LangGraph。

### Tool

Tool Registry 只负责注册和解析工具。当前只有 `execute_shell`，用于验证 agent loop 的工具调用链路。

### Runtime

Runtime 使用 NeuroAgent `createAgent()`，直接产出 v3 自己的事件类型。当前只使用内存消息，不写数据库，不做 checkpoint。

### Memory

Memory 是线性消息数组，负责在一次 run 后保存 assistant 消息。后续再扩展为 thread store、分支树和持久化。
