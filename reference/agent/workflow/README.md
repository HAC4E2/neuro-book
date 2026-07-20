# Workflow 编写参考（Agent Workflow Authoring Reference）

本页是 `run_workflow` 工具的配套参考：workflow 定义结构、`wf` API、可视化 `wf.chart` 规范与确定性红线。目录约定与内置 workflow 清单见本目录其他文档（Task 111 D 模块扩写中）。

## 存放与寻址

- 系统内置：`assets/workspace/.nbook/agent/workflows/<key>/workflow.ts`
- 用户覆盖：Workspace Root `.nbook/agent/workflows/<key>/workflow.ts`（同名目录整体覆盖系统目录）
- 目录名是稳定 key；`run_workflow({workflowKey})` 按目录名寻址。
- 临时 workflow 不落盘：`run_workflow({script})` 直接传源码。

## workflow.ts 结构

```ts
export default {
    key: "my-workflow",              // 会被目录名覆盖，仍建议写一致
    title: "人话标题",
    description: "一句话说明做什么",
    whenToUse: "什么场景该选它（leader 按此选用）",
    argsHint: [                       // 用户主动触发时的表单提示，可省略
        {name: "path", label: "书稿路径", defaultValue: "manuscript/book.md"},
    ],
    phases: [                         // 阶段声明（进度条投影），可省略
        {key: "read", title: "读取"},
    ],
    run: async (wf: any, args: any) => {
        // 编排逻辑；返回值就是 run 结果（必须是 JSON 值）
        return {ok: true};
    },
};
```

**红线**：workflow 源码不允许 `import`/`require`——所有能力通过 `wf` API 提供，违反会在加载时报错。

## wf API（V1 收敛面）

- `wf.agents.create(profileKey, {initial?, tags?, parent?, ephemeral?, model?})` → SessionHandle。
  - `ephemeral: true`：run 成功后自动归档（一次性帮工用它）。
  - `model`: "provider/model" key，只能选用户配置的 agent 可见模型清单（`list_workflows` 可查）；缺省用 run 级默认，再缺省用 profile 默认。
- `wf.agents.acquire({profileKey, tag, parent?})`：持久参与者——按 (profileKey, tag) 找未归档 session，找到复用，没有才建。跨 run 连续记忆用它。
- `handle.invoke({mode?, message?, input?})` → `{status, result: {message, data}}`：一轮真实 agent 调用。
- `handle.append({role, message?, input?})` / `handle.checkout(entryId)` / `handle.excursion(at, fn)`：session 树写原语；excursion 开旁支干活、结束自动回原位（旁支留树上可追溯）。
- `wf.map(items, fn, {concurrency?})` / `wf.all(thunks)`：并发。**必须经这两个 API 并发**，裸 Promise.all 会破坏重放确定性。
- `wf.ask({kind: "select"|"text"|"approve", title, options?, multi?})`：人类参与点；无应答时 run 挂起（waiting），用户在 workflow 面板应答后续跑。
- `wf.workspace.read(path)`：只读读取当前 Project Workspace 文件（`manuscript/...`、`lorebook/...` 等，与 read 工具同一套路径语义与授权）。
- `wf.log(message)` / `wf.progress({phase, done?, total?})`：观测输出。
- `wf.caller()`：发起方 session 句柄（仅 agent 经工具触发时存在）。
- `wf.args`：run 入参。

## wf.chart：状态图（必用，用户全程看它）

零预置、只增不删：图只在执行过程中长出来，终图即流程记录。

- `chart.node(key, title?)` / `chart.edge(from, to, label?)`：增量声明节点与边。
- `chart.enter(key, {token?, sessionId?})` / `chart.leave(key, {token?})` / `chart.move(from, to, {token?, sessionId?, label?})`：token = 一条并行执行线（默认 "main"；map 分支用 item id 当 token）；附 sessionId 会把该 agent 的名字持久标在节点上。

构图口诀：

1. 起点一个 node + enter；
2. map 扇出：每项 `node` + `edge(起点, 节点)` + `enter/leave({token: 项id, sessionId})`；
3. 汇合：先 `node("merge")`，每项完成时 `edge(项节点, "merge", "合并")`；
4. 主线推进用 `move(from, to, {label})`（边上会带执行序号 ①②③）；
5. 同一 session 的分支（excursion）画两个 node，标题都写同一个 session，用 move 表达开叉/写回。

不画 chart 的 workflow 视为不合格：用户在气泡里只能看到黑盒。

## 确定性红线（重放/缓存依赖）

- 禁 `Date.now()` / `Math.random()` / 读环境——同一 run 重放时代码必须走出同一条 Activity 序列。
- 一切副作用走 `wf` API（它们才会进 journal，挂起恢复/失败重跑时命中缓存不重跑）。
- 参数变了对应分支自动失效重跑，其余缓存命中——把易变参数放进 invoke 的 input/message 里即可。

## 返回契约

`run` 的返回值是 workflow 自定义结果；平台自动附加元数据一起返给调用方：touched sessions（sessionId/profileKey/title/token 用量）、run 级 usage 汇总、终态状态图。
