/**
 * 假 `gh`（t14 的 L3）：只认面板写死的两条 `… list --json`。把收到的参数与几个环境变量记进 `FAKE_GH_LOG`（一行一个 JSON）。
 * 模式取 `FAKE_GH_MODE_FILE` 文件的内容（测试中途可以改）：`ok`、`auth`（没登录，以 4 退出）、`slow`（睡 30 秒）、`fail`（以 1 退出）、`bad`（输出不是 JSON）。
 * `FAKE_GH_ISSUES` 给 issue 的条数（缺省 3）。
 */
import {appendFileSync, existsSync, readFileSync} from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({args, prompt: process.env.GH_PROMPT_DISABLED ?? null, notifier: process.env.GH_NO_UPDATE_NOTIFIER ?? null, color: process.env.NO_COLOR ?? null})}\n`);
const file = process.env.FAKE_GH_MODE_FILE;
const mode = file && existsSync(file) ? readFileSync(file, "utf8").trim() : "ok";
if (mode === "auth") {
    process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n");
    process.exit(4);
}
if (mode === "fail") {
    process.stderr.write("HTTP 502: bad gateway\n");
    process.exit(1);
}
if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 30_000));
if (mode === "bad") {
    process.stdout.write("not json");
    process.exit(0);
}
if (args[0] === "pr") {
    process.stdout.write(JSON.stringify([
        {number: 7, title: "<b>标题</b> 加粗不生效", headRefName: "feat/w00001-t01-seed", isDraft: false, reviewDecision: "", updatedAt: "2026-10-13T08:00:00Z", url: "https://github.com/x/y/pull/7", statusCheckRollup: [
            {__typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/x/y/runs/1"},
            {__typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/x/y/runs/2"},
            {__typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/x/y/runs/3"},
            {__typename: "StatusContext", context: "ci/legacy", state: "ERROR", targetUrl: "javascript:alert(1)"},
            {__typename: "StatusContext", context: "ci/ok", state: "SUCCESS", targetUrl: "https://ci.example/ok"},
        ]},
        {number: 8, title: "别的分支", headRefName: "some-branch", isDraft: true, reviewDecision: "APPROVED", updatedAt: "2026-10-12T08:00:00Z", url: "http://insecure.example/pr/8", statusCheckRollup: []},
    ]));
} else {
    const count = Number(process.env.FAKE_GH_ISSUES ?? "3");
    process.stdout.write(JSON.stringify(Array.from({length: count}, (_, index) => ({number: index + 1, title: `问题 ${index + 1}`, labels: [{name: "bug"}], updatedAt: "2026-10-13T08:00:00Z", url: `https://github.com/x/y/issues/${index + 1}`}))));
}
