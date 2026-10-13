#!/usr/bin/env -S python3 -I -u
# L4 的假 Claude 界面（t11）：复制成名为 claude 的可执行文件在命名会话的 pane 里运行，herdr 按进程名认成 Claude 并按清单读屏。
# tty 设为 raw、开 bracketed paste；SCREEN 文件一变就清屏重画；收到的输入逐条以 repr 记到 FAKE_LOG。不调任何模型。
# 给了 REACT（JSON 文件 {"mode": ...}）与 REACT_SCREENS（JSON 文件，含 working、trust 两屏）就对输入作出反应（t11 追加修正审查的 L4）：
# - work：收到回车就画“工作中”；
# - blocked_in_paste：收到粘贴就画信任确认（herdr 判 blocked），回车之后画“工作中”，扮“粘贴窗口里弹出确认、回车确认了它”。
import os, sys, tty, termios, time, select, json
log = os.environ.get("FAKE_LOG", "/dev/null")
screen = os.environ["SCREEN"]
react = os.environ.get("REACT")
react_screens = json.load(open(os.environ["REACT_SCREENS"], encoding="utf-8")) if os.environ.get("REACT_SCREENS") else {}
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
last = None
def paint(text):
    sys.stdout.write("\x1b[?2004h\x1b[2J\x1b[H" + text.replace("\n", "\r\n"))
    sys.stdout.flush()
def draw():
    with open(screen, encoding="utf-8") as f:
        paint(f.read())
def react_mode():
    if not react:
        return "none"
    with open(react, encoding="utf-8") as f:
        return json.load(f).get("mode", "none")
try:
    while True:
        try:
            m = os.stat(screen).st_mtime_ns
        except FileNotFoundError:
            m = None
        if m is not None and m != last:
            last = m
            draw()
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            b = os.read(fd, 4096)
            if not b:
                break
            with open(log, "ab") as f:
                f.write(("%.3f %r\n" % (time.time(), b)).encode())
            mode = react_mode()
            if mode == "blocked_in_paste" and b"\x1b[200~" in b:
                paint(react_screens["trust"])
            if mode in ("work", "blocked_in_paste") and b"\r" in b:
                paint(react_screens["working"])
            if b == b"\x1d":
                break
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
