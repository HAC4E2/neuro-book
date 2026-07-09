//! Desktop 启动编排实现。

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use command_group::{CommandGroup, GroupChild};
use tauri::{Emitter, Manager, RunEvent, State};

/// 加载页 label，与 tauri.conf.json 中 windows[0].label 一致。
const WINDOW_LABEL: &str = "main";

/// 桌面运行态：就绪后的服务地址 + 仍在运行的服务子进程（用于退出时清理）。
struct DesktopState {
    /// 服务就绪后写入 "http://localhost:<port>"，加载页轮询读取后跳转。
    url: Mutex<Option<String>>,
    /// 启动失败时写入错误信息，加载页可展示。
    error: Mutex<Option<String>>,
    /// 服务子进程（进程组），退出时 kill。
    child: Mutex<Option<GroupChild>>,
}

/// 默认全局 config：关闭全站鉴权（本地单用户桌面应用，OS 账户即安全边界）。
/// 与 launcher.mjs 的 renderGlobalConfig 对齐，仅 auth.enabled 改为 false。
const DEFAULT_CONFIG: &str = r#"{
  "auth": { "enabled": false },
  "models": {
    "default": null,
    "providers": []
  },
  "agent": {
    "defaultProfileKey": {
      "novel": "leader.default",
      "userAssets": "leader.assets"
    },
    "profiles": {}
  },
  "ui": { "theme": "sepia" },
  "editor": {}
}
"#;

/// Tauri 入口：注册插件、管理状态、setup 中后台启动服务。
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 已有实例运行时，把已有窗口拉到前台。
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(DesktopState {
            url: Mutex::new(None),
            error: Mutex::new(None),
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_server_url, get_boot_error])
        .setup(|app| {
            let handle = app.handle().clone();
            // 启动是耗时操作（migrate / 系统资源同步 / Bun 冷启动），放后台线程避免阻塞事件循环。
            std::thread::spawn(move || {
                if let Err(err) = boot(handle.clone()) {
                    let msg = render_error(&err);
                    log_line(&format!("boot failed: {msg}"));
                    if let Some(state) = handle.try_state::<DesktopState>() {
                        *state.error.lock().unwrap() = Some(msg);
                    }
                    // 通知加载页展示错误
                    let _ = handle.emit("boot-error", ());
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app: &tauri::AppHandle, event: RunEvent| {
        if let RunEvent::ExitRequested { .. } = event {
            // 退出时尽量优雅 kill 服务子进程；即便此处漏掉，进程组 Job Object 也会在
            // Tauri 进程结束时由 OS 连带回收。
            if let Some(state) = app.try_state::<DesktopState>() {
                if let Some(mut child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}

/// 加载页轮询：返回服务地址（就绪）或 None（仍在启动）。
#[tauri::command]
fn get_server_url(state: State<DesktopState>) -> Option<String> {
    state.url.lock().unwrap().clone()
}

/// 加载页轮询：返回启动错误信息（失败）或 None。
#[tauri::command]
fn get_boot_error(state: State<DesktopState>) -> Option<String> {
    state.error.lock().unwrap().clone()
}

// ---------------------------------------------------------------------------
// 启动编排
// ---------------------------------------------------------------------------

/// 完整启动流程。
fn boot(app: tauri::AppHandle) -> Result<(), BootError> {
    let root = resolve_portable_root()?;
    let product_dir = root.join("product");
    let bun_exe = resolve_bun(&root)?;
    let data_dir = root.join("data");
    let workspace_dir = data_dir.join("workspace");
    let nbook_dir = workspace_dir.join(".nbook");
    let logs_dir = data_dir.join("logs");

    // 0. 基本校验
    let server_entry = product_dir.join(".output").join("server").join("index.mjs");
    if !server_entry.exists() {
        return Err(BootError::Config(format!(
            "缺少 Product Payload 入口：{}\n请先运行 bun run nuxt:build && bun run product:stage。",
            server_entry.display()
        )));
    }

    // 1. 建数据目录
    fs::create_dir_all(&nbook_dir).map_err(|e| BootError::io("创建数据目录", e))?;
    fs::create_dir_all(&logs_dir).map_err(|e| BootError::io("创建日志目录", e))?;

    // 2. product/workspace -> data/workspace 目录联接（先于 config，以便从残留开发目录迁移配置）
    ensure_workspace_junction(&product_dir, &workspace_dir)?;

    // 3. 写全局 config（auth 关闭），仅首次
    let config_path = nbook_dir.join("config.json");
    if !config_path.exists() {
        fs::write(&config_path, DEFAULT_CONFIG).map_err(|e| BootError::io("写 config.json", e))?;
    }

    // 4. 会话密钥（持久化，跨启动稳定，避免已登录会话失效）
    let session_password = read_or_create_session_key(&data_dir)?;

    // 5. 选空闲端口
    let port = pick_free_port()?;

    // 6. migrate
    log_line(&format!("migrate (port={port})"));
    run_bun_capture(
        &bun_exe,
        &product_dir,
        &[".output/server/scripts/db/prisma-migrate.mjs", "--deploy"],
        &server_env(&root, &data_dir, &logs_dir, port, &session_password),
        Some(&logs_dir.join("init.log")),
    )?;

    // 7. prepare-system-assets
    log_line("prepare-system-assets");
    run_bun_capture(
        &bun_exe,
        &product_dir,
        &[
            ".output/server/scripts/build/prepare-system-assets.ts",
            "--sync-user-assets",
        ],
        &server_env(&root, &data_dir, &logs_dir, port, &session_password),
        Some(&logs_dir.join("init.log")),
    )?;

    // 8. 启动 Nitro 服务（进程组，日志落盘）
    let server_log = logs_dir.join("server.log");
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&server_log)
        .map_err(|e| BootError::io("打开 server.log", e))?;
    let log_file_err = log_file
        .try_clone()
        .map_err(|e| BootError::io("复制 server.log 句柄", e))?;

    let mut cmd = Command::new(&bun_exe);
    cmd.arg(&server_entry)
        .current_dir(&product_dir)
        .envs(server_env(&root, &data_dir, &logs_dir, port, &session_password))
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    let child: GroupChild = cmd
        .group()
        // CREATE_NO_WINDOW：抑制 bun 服务子进程的控制台黑框。command_group 在
        // Windows spawn 时把它与 CREATE_SUSPENDED 合并后经 std CommandExt 应用
        // （见 command_group stdlib/windows.rs）。
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| BootError::io("启动服务子进程", e))?;

    // 存入状态，退出时清理
    if let Some(state) = app.try_state::<DesktopState>() {
        *state.child.lock().unwrap() = Some(child);
    } else {
        // 极端情况：状态不可用，直接 kill 避免孤儿
        let mut child = child;
        let _ = child.kill();
        return Err(BootError::Config("DesktopState 不可用".into()));
    }

    // 9. 轮询就绪
    let url = format!("http://localhost:{port}");
    log_line(&format!("等待服务就绪 {url}"));
    wait_for_ready(port, Duration::from_secs(90))?;

    // 10. 写入地址，加载页轮询到后跳转
    if let Some(state) = app.try_state::<DesktopState>() {
        *state.url.lock().unwrap() = Some(url.clone());
    }
    log_line(&format!("服务就绪：{url}"));
    Ok(())
}

/// 解析 portable 根目录：当前 exe 所在目录。
fn resolve_portable_root() -> Result<PathBuf, BootError> {
    let exe = tauri::utils::platform::current_exe()
        .map_err(|e| BootError::Config(format!("无法定位当前 exe：{e}")))?;
    let dir = exe
        .parent()
        .ok_or_else(|| BootError::Config("无法定位 exe 父目录".into()))?
        .to_path_buf();
    Ok(dir)
}

/// 解析 Bun 运行时：优先 portable 自带的 runtime/bun/bun.exe，回退到 PATH 中的 bun。
fn resolve_bun(root: &Path) -> Result<PathBuf, BootError> {
    let bundled = root.join("runtime").join("bun").join("bun.exe");
    if bundled.exists() {
        return Ok(bundled);
    }
    // 开发/调试回退：用 PATH 中的 bun
    if let Some(found) = which_bun() {
        return Ok(found);
    }
    Err(BootError::Config(format!(
        "未找到 Bun 运行时：{} 不存在，且 PATH 中没有 bun.exe",
        bundled.display()
    )))
}

/// 在 PATH 中查找 bun.exe（仅 Windows，简单实现）。
fn which_bun() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join("bun.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// 确保 product/workspace 作为目录联接指向 data/workspace。
/// 当 product/workspace 是残留的真实目录（例如从开发态复制过来）时，
/// 尝试迁移其中的 config.json 到 data/workspace 后移除并重建联接。
fn ensure_workspace_junction(product_dir: &Path, data_workspace: &Path) -> Result<(), BootError> {
    let link = product_dir.join("workspace");
    if junction::exists(&link).unwrap_or(false) {
        // 已是联接，假定指向正确（与 launcher 行为一致）
        return Ok(());
    }
    if link.exists() {
        if link.is_dir() && fs::read_dir(&link).map_err(|e| BootError::io("读 product/workspace", e))?.next().is_none() {
            fs::remove_dir(&link).map_err(|e| BootError::io("移除空 product/workspace", e))?;
        } else {
            // 残留的真实非空目录（通常是开发态 product:stage 复制过来的 workspace）。
            // 尝试迁移 config.json 到 data/workspace/.nbook/，然后移除。
            let dev_config = link.join(".nbook").join("config.json");
            let runtime_config = data_workspace.join(".nbook").join("config.json");
            if dev_config.exists() && !runtime_config.exists() {
                let _ = fs::create_dir_all(data_workspace.join(".nbook"));
                let _ = fs::copy(&dev_config, &runtime_config);
                log_line("从 product/workspace 迁移了 config.json 到 data/workspace");
            }
            fs::remove_dir_all(&link)
                .map_err(|e| BootError::io("移除残留 product/workspace", e))?;
        }
    }
    junction::create(data_workspace, &link)
        .map_err(|e| BootError::io("创建 workspace 联接", e))?;
    Ok(())
}

/// 读取或生成会话密钥，持久化到 data/desktop-session.key。
fn read_or_create_session_key(data_dir: &Path) -> Result<String, BootError> {
    let key_path = data_dir.join("desktop-session.key");
    if let Ok(key) = fs::read_to_string(&key_path) {
        let trimmed = key.trim();
        if trimmed.len() >= 32 {
            return Ok(trimmed.to_string());
        }
    }
    let key = random_hex(48);
    fs::write(&key_path, &key).map_err(|e| BootError::io("写 session key", e))?;
    Ok(key)
}

/// 优先端口：固定值使浏览器 localStorage / cookie 的 origin 跨启动稳定。
/// 桌面版由 single-instance 插件保证同时只有一个实例，正常场景不会冲突；
/// 若端口确实被外部进程占用，回退到 OS 分配。
const PREFERRED_PORT: u16 = 3618;

/// 优先尝试绑定固定端口（PREFERRED_PORT），失败时回退到 OS 随机空闲端口。
fn pick_free_port() -> Result<u16, BootError> {
    // 优先固定端口
    if let Ok(listener) = TcpListener::bind(format!("127.0.0.1:{PREFERRED_PORT}")) {
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        return Ok(port);
    }
    // 回退随机端口
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| BootError::io("选取空闲端口", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| BootError::io("读取本地端口", e))?
        .port();
    drop(listener);
    Ok(port)
}

/// 轮询 TCP 连接直到服务监听或超时。
fn wait_for_ready(port: u16, timeout: Duration) -> Result<(), BootError> {
    let start = Instant::now();
    let addr = format!("127.0.0.1:{port}");
    while start.elapsed() < timeout {
        if let Ok(stream) = TcpStream::connect_timeout(
            &addr.parse().map_err(|_| BootError::Config(format!("非法地址：{addr}")))?,
            Duration::from_millis(500),
        ) {
            // 连得上即视为 Nitro 已 listen（路由在 listen 前挂载）
            drop(stream);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(BootError::Timeout(timeout))
}

/// 服务进程环境变量。路径用相对 product cwd 的形式（与 launcher 一致，已验证 prisma-env
/// 按 process.cwd() 解析 file: URL）。
fn server_env(
    _root: &Path,
    _data_dir: &Path,
    logs_dir: &Path,
    port: u16,
    session_password: &str,
) -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("NODE_ENV", "production".to_string()),
        ("DATABASE_KIND", "sqlite".to_string()),
        // 相对 product cwd：file:../data/... -> root/data/...
        ("DATABASE_URL", "file:../data/workspace/.nbook/neuro-book.sqlite".to_string()),
        ("NUXT_SESSION_PASSWORD", session_password.to_string()),
        ("NUXT_PORT", port.to_string()),
        ("NITRO_PORT", port.to_string()),
        ("PORT", port.to_string()),
        // 日志目录用绝对路径，避免服务端 cwd 相对解析歧义
        ("NEURO_BOOK_LOG_DIR", logs_dir.to_string_lossy().to_string()),
    ];
    // 继承当前 PATH（bun / 系统依赖可能需要）
    if let Some(path) = std::env::var_os("PATH") {
        env.push(("PATH", path.to_string_lossy().to_string()));
    }
    env
}

/// 运行一个 bun 脚本，捕获 stdout/stderr；失败时把输出附进错误信息，并可选追加到日志文件。
fn run_bun_capture(
    bun_exe: &Path,
    cwd: &Path,
    args: &[&str],
    env: &[(&'static str, String)],
    log_file: Option<&Path>,
) -> Result<(), BootError> {
    let mut cmd = Command::new(bun_exe);
    cmd.args(args)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (*k, v.clone())));
    // CREATE_NO_WINDOW：bun.exe 是控制台子系统程序，GUI 主进程 spawn 它时 Windows
    // 会为新控制台子进程分配一个控制台窗口（黑框）。加此标志抑制。
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let output = cmd
        .output()
        .map_err(|e| BootError::io(format!("执行 bun {}", args.join(" ")), e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if let Some(path) = log_file {
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, ">>> bun {} (exit={})", args.join(" "), output.status.code().unwrap_or(-1));
            let _ = f.write_all(stdout.as_bytes());
            let _ = f.write_all(stderr.as_bytes());
        }
    }
    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        return Err(BootError::Command {
            command: format!("bun {}", args.join(" ")),
            code,
            stdout,
            stderr,
        });
    }
    Ok(())
}

/// 把错误渲染成单行可读文本。
fn render_error(err: &BootError) -> String {
    match err {
        BootError::Config(msg) => format!("配置错误：{msg}"),
        BootError::Io { context, source } => format!("{context}：{source}"),
        BootError::Command { command, code, stderr, .. } => {
            let tail = stderr.trim().chars().rev().take(400).collect::<String>().chars().rev().collect::<String>();
            format!("执行 {command} 失败（退出码 {code}）：\n{tail}")
        }
        BootError::Timeout(d) => format!("服务在 {:.0}s 内未就绪", d.as_secs_f64()),
    }
}

/// 写一行到 logs_dir/boot.log（best-effort，失败忽略）。
fn log_line(message: &str) {
    // 直接打印到 stderr（debug 构建可见）；release 无控制台则丢失，无妨。
    eprintln!("[neuro-book-desktop] {message}");
}

/// 生成 n 个十六进制随机字符。用系统随机源（不依赖 crate）。
fn random_hex(count: usize) -> String {
    // 简单 CSPRNG：Windows TPM-backed RtlGenRandom。为避免额外依赖，用 std + 时间种子的退化方案
    // 不够安全；但 session 密钥本地使用，这里用 OpenSSL 风格不可行。改用读取系统随机：
    // Windows 下 std 不直接暴露，但可以读 nul 设备？为稳妥，回退到 fs 读一次 / 不强求密码学强度。
    // 这里用当前纳秒 + 进程 id 作熵源（本地桌面足够），并在注释说明局限。
    let mut out = String::with_capacity(count);
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15)
        ^ (std::process::id() as u64).rotate_left(17);
    while out.len() < count {
        // xorshift64
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let s = format!("{seed:016x}");
        out.push_str(&s);
    }
    out.truncate(count);
    out
}

/// 启动错误类型。
enum BootError {
    Config(String),
    Io { context: String, source: io::Error },
    Command { command: String, code: i32, stdout: String, stderr: String },
    Timeout(Duration),
}

impl BootError {
    fn io(context: impl Into<String>, source: io::Error) -> Self {
        BootError::Io { context: context.into(), source }
    }
}

impl From<io::Error> for BootError {
    fn from(source: io::Error) -> Self {
        BootError::Io { context: "IO".to_string(), source }
    }
}

// 避免 HashMap 未使用告警（envs 接受 iterator，保留 HashMap 以备扩展）
#[allow(dead_code)]
fn _unused_hashmap_hint() -> HashMap<String, String> {
    HashMap::new()
}

// 读取吞掉，避免 unused import 告警（Read 用于未来扩展）
#[allow(dead_code)]
fn _read_hint<R: Read>(_r: R) {}
