#!/usr/bin/env -S python3 -I -u
# L4 的假 Claude 界面（t11）：复制成名为 claude 的可执行文件在命名会话的 pane 里运行，herdr 按进程名认成 Claude 并按清单读屏。
# tty 设为 raw、开 bracketed paste；SCREEN 文件一变就清屏重画；收到的输入逐条以 repr 记到 FAKE_LOG。不调任何模型。
import os, sys, tty, termios, time, select
log = os.environ.get("FAKE_LOG", "/dev/null")
screen = os.environ["SCREEN"]
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
last = None
def draw():
    with open(screen, encoding="utf-8") as f:
        text = f.read()
    sys.stdout.write("\x1b[?2004h\x1b[2J\x1b[H" + text.replace("\n", "\r\n"))
    sys.stdout.flush()
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
            if b == b"\x1d":
                break
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
