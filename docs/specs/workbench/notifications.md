---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.notifications
owners:
  - nbook.workbench
---

# 工作台通知

## 目标与非目标

给窗口里的插件一个统一的通知去处：一次操作的结果、后台的失败与长任务的进度，经工作台的通知服务发出，显示在窗口右下角；能当场改的输入在字段下提示，整页或整视图不可用的原位阻断。本 Spec 定三个去处的分工、通知服务的合同、视口的位置与时长规则。

不承诺：

- 通知中心（翻历史）、活动栏角标、系统通知、标签页标题计数：以后另定。
- 持续存在的连接状态横幅：组件 `Banner` 已在 nb-ui，第一个使用者随浏览器宿主的断线重连另定。
- 跨窗口的通知：每个窗口一份队列，别的窗口看不到。

## 术语与参与者

- **去处**：一条提示该显示在哪：字段下、通知、原位。判据是“用户能对它做什么”。
- **通知服务**：`nbook.workbench` 提供的服务 `nbook.workbench/notifications`（`notificationsKey`），插件在入口依赖里声明后经 `notify` 发出通知。
- **视口**：nb-ui 的 `NotificationViewport`，挂在工作台两个内置页面的根上，显示本窗口的队列。
- 参与者：发出通知的插件（书架、编辑器、文件等）；工作台（队列、视口）；用户（关闭、点动作）。

## 输入与前置条件

- 服务合同（`nbook/plugins/workbench/shared/contracts`）：

  ```ts
  interface NotificationInput {
      tone?: "info" | "success" | "warning" | "error";   // 缺省 info
      title?: string;
      message: string;
      action?: {label: string; run: () => void};
      progress?: number | null;                           // 0 到 100；null 不确定进度；不给就没有进度条
      sticky?: boolean;                                   // 常驻；缺省 error 与带动作的常驻
  }
  interface NotificationHandle { id: string; update(patch: Partial<NotificationInput>): void; dismiss(): void }
  interface Notifications { notify(input: NotificationInput): NotificationHandle }
  ```

- 文字由发出方按当前显示语言写好；服务不翻译、不改写。
- 文案格式：标题说发生了什么（“书架没有更新”），正文说原因与现在显示的是什么（“取不到作品列表：连接已断开。显示的是上次的数据。”），动作说能做什么（“重试”）。

## 输出与可观察行为

1. **三个去处。** 用户在当前界面就能改的输入（本地校验不过、服务端针对这个字段的拒绝）显示在该字段下，不发通知；一次操作做完的结果与后台的失败发通知；整页或整视图不可用（首次取数失败、窗口失败页、视图加载失败）原位显示原因与重试，不发通知。工作台里持续存在的问题（布局未保存、偏好未保存）仍走状态栏条目。
2. **发出。** `notify` 把通知加进本窗口的队列并返回句柄；视口按加入顺序从下往上堆叠在窗口右下角，容器至多 448px 宽，窄屏按视口宽度收窄。
3. **时长。** `sticky` 为真、`tone` 为 `error` 或带 `action` 的通知不自动消失；其余按色调自动消失（info、success 3.2 秒，warning 4.2 秒）。指针停在一条通知上时它的计时暂停，离开后按剩余时间继续、至少再留 0.8 秒。每条通知都有关闭按钮。
4. **动作。** 点动作按钮执行 `run` 并移除该通知；`run` 抛错时通知仍移除，错误记诊断。
5. **更新与移除。** `update` 改标题、正文、色调、动作、进度与常驻；改了色调、动作或 `sticky` 时按新值重算是否常驻并从现在重新计时（进度通知在任务结束后改成 `success` 就会按时消失）；发出时或之后明确给过的 `sticky` 一直算数，直到再次明确改它；指针停在通知上时改了也只重算到期时间，离开后才按剩余时间继续。`dismiss` 立即移除；已消失的通知再 `update` 或 `dismiss` 无效果。
6. **进度。** `progress` 为数字时通知正文下画一条确定进度条，`null` 画不确定进度条（系统设了减少动画时不动）。
7. **寿命。** 队列与 `nbook.workbench` 的浏览器入口同寿：入口停止时清空队列与计时器；页面切换（`/` 与 `/workbench` 之间）不清空。Lab 页面不挂产品视口，Lab 场景要通知时自建队列。
8. **可访问性。** 每条通知是 `role="status"`；关闭按钮有可访问名称；视口不拦截空白处的指针事件。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 不在队列 | `notify` | 显示中（限时或常驻） |
| 显示中（限时） | 到时 | 移除 |
| 显示中（限时） | 指针进入 | 计时暂停 |
| 计时暂停 | 指针离开 | 显示中（剩余时间，至少 0.8 秒） |
| 显示中 | `update` 改了色调、动作或 `sticky` | 显示中，按新值重算常驻并重新计时 |
| 显示中 | 点动作、点关闭、`dismiss` | 移除 |
| 任一 | 入口停止 | 移除 |

时序与寿命：句柄在通知移除后仍可调用，调用无效果；`run` 在视口的点击处理里同步调用。

## 副作用与数据

无持久化；队列只在内存里。

## 失败与恢复

| 情形 | 行为 |
|---|---|
| `run` 抛错 | 通知移除，错误记诊断（`workbench.notifications`） |
| 没有页面根（视口未挂载） | 通知仍进队列，视口挂上后显示 |

## 边界与兼容

- 公开接口：`notificationsKey`、`Notifications`、`NotificationInput`、`NotificationHandle`（`nbook/plugins/workbench/shared/contracts`）。
- nb-ui 侧：`createNotificationQueue`、`NotificationViewport` 的 `queue`、`Notification` 的 `progress`、`Banner`（`@notnotype/nb-ui`）。
- 信任边界：文字按纯文本渲染，不解释 HTML。

## 验收与 Smoke

1. Given 书架页，When 刷新失败，Then 右下角出现“书架没有更新”带“重试”且不自动消失；点“重试”后通知消失并重新取数；恢复后不再出现。
2. Given 两个内置页面，When 在 `/` 发出通知后导航到 `/workbench`，Then 通知仍在。
3. Given 一条带进度的通知，When 发出方推进到 100 并改成 success，Then 进度条走到头、通知在 3.2 秒后消失。

Smoke：`notifications.dom.test.ts`（真实队列与视口）；Lab 场景 `NotificationViewport`、`Notification`（进度）、`Banner`。

## 证据

- 批准依据：开发者 2026-10-11 在 t76 的设计讨论中决定通知按三个去处分工、形式补足到 nb-ui 与应用的通用组件（[t76 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t76-bookshelf-polish/plan.md)）。
