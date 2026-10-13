/**
 * 假 `lab:shot`（t14 的 L3）：把收到的参数与 `TMPDIR` 写进 `--out` 目录的 `args.json`，再写一张假截图；`FAKE_SHOT_FAIL=1` 时以 1 退出。
 */
import {existsSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1]!;
writeFileSync(join(out, "args.json"), JSON.stringify({args, tmpdir: process.env.TMPDIR ?? null, tmpdirExists: existsSync(process.env.TMPDIR ?? "/nonexistent")}));
writeFileSync(join(out, "Foo-phone.png"), "png");
if (process.env.FAKE_SHOT_FAIL === "1") {
    process.stderr.write("截图失败：假的\n");
    process.exit(1);
}
