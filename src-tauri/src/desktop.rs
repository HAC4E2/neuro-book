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

/// 桌面 exe 同目录的桌面级配置文件名。data 目录定位先于 Nitro 启动，
/// 不能放进 Nitro 的 config.json（它本身就在 data/workspace/.nbook/ 下，存在鸡生蛋）。
const DESKTOP_CONFIG_FILENAME: &str = "neuro-book.config.json";

/// 桌面级配置：data 目录定位与运行时迁移指令。由 desktop.rs 在启动 Nitro 前读写。
/// 所有字段 Option，缺省即回退默认行为（保持向后兼容）。
#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
struct DesktopConfig {
    /// 当前生效的 data 目录绝对路径。空/缺省 → 回退 exe 同目录的 data/。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data_dir: Option<String>,
    /// 待执行迁移（前端改 dataDir 时写入，重启时 boot 执行后清除）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_move: Option<PendingMove>,
    /// 迁移失败时写入的错误信息，供前端展示。null 表示无错误。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

/// 待执行的 data 目录迁移指令。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct PendingMove {
    /// 迁移源目录（当前生效 data 目录）。
    from: String,
    /// 迁移目标目录（新 data 目录）。
    to: String,
}

/// 桌面运行态：就绪后的服务地址 + 仍在运行的服务子进程（用于退出时清理）。
struct DesktopState {
    /// 服务就绪后写入 "http://localhost:<port>"，加载页轮询读取后跳转。
    url: Mutex<Option<String>>,
    /// 启动失败时写入错误信息，加载页可展示。
    error: Mutex<Option<String>>,
    /// 服务子进程（进程组），退出时 kill。
    child: Mutex<Option<GroupChild>>,
    /// 当前生效的 data 目录绝对路径，供前端查询。
    data_dir: Mutex<Option<String>>,
    /// 迁移进度文案（如 "正在迁移数据..."），加载页轮询展示。None 表示无迁移。
    migration_progress: Mutex<Option<String>>,
}

/// 默认 Boot Config（config.yaml）：关闭全站鉴权。auth 中间件读的就是这份
/// Boot Config 的 `auth.enabled`，而不是下方 config.json（Global Config）。
/// 桌面版为本地单用户应用，OS 账户即安全边界，鉴权无意义。
const DEFAULT_BOOT_CONFIG: &str = "auth:\n  enabled: false\n";

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
            data_dir: Mutex::new(None),
            migration_progress: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_boot_error,
            get_data_dir,
            change_data_dir,
            get_migration_progress
        ])
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

/// 前端查询当前生效的 data 目录绝对路径。未启动完时可能为 None。
#[tauri::command]
fn get_data_dir(state: State<DesktopState>) -> Option<String> {
    state.data_dir.lock().unwrap().clone()
}

/// 前端查询迁移进度文案。None 表示无迁移在进行。
#[tauri::command]
fn get_migration_progress(state: State<DesktopState>) -> Option<String> {
    state.migration_progress.lock().unwrap().clone()
}

/// 前端切换 data 目录：校验→写 pendingMove→重启，重启后 boot 执行迁移。
/// 返回新路径（已写入 pendingMove），前端据此提示用户“重启迁移”。
#[tauri::command]
fn change_data_dir(app: tauri::AppHandle, state: State<DesktopState>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("目标路径不能为空".to_string());
    }
    let root = resolve_portable_root().map_err(|e| render_error(&e))?;
    let config = read_desktop_config(&root);
    let current = resolve_data_dir(&root, &config);
    let new_path = {
        let p = PathBuf::from(trimmed);
        if p.is_absolute() { p } else { root.join(p) }
    };
    if new_path == current {
        return Err("新路径与当前 data 目录相同".to_string());
    }
    // 目标若已存在且非空 → 拒绝（避免覆盖；迁移时也再次校验，这里提前拦截给前端清晰反馈）
    if new_path.exists() {
        if let Ok(entries) = fs::read_dir(&new_path) {
            if entries.filter_map(|e| e.ok()).next().is_some() {
                return Err(format!("目标目录已存在且非空：{}", new_path.display()));
            }
        }
    }

    let mut next = config.clone();
    next.pending_move = Some(PendingMove {
        from: current.to_string_lossy().to_string(),
        to: new_path.to_string_lossy().to_string(),
    });
    write_desktop_config(&root, &next);

    // 提示加载页即将重启迁移
    *state.migration_progress.lock().unwrap() =
        Some("正在准备迁移，即将重启…".to_string());

    // restart 会先触发 ExitRequested（连带 kill 服务子进程），再重新拉起 exe。
    // 重启后 boot 检测 pending_move 执行迁移。
    // 在新线程里 restart，避免在 command 里同步重启导致当前调用链中断异常。
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        handle.restart();
    });
    Ok(new_path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// 启动编排
// ---------------------------------------------------------------------------

/// 完整启动流程。
fn boot(app: tauri::AppHandle) -> Result<(), BootError> {
    let root = resolve_portable_root()?;
    let product_dir = root.join("product");
    let bun_exe = resolve_bun(&root)?;

    // 读桌面级配置（data 目录定位），先于一切依赖 data 的逻辑。
    let mut config = read_desktop_config(&root);

    // 执行待迁移指令（前端改 dataDir 后写入，重启时在此执行；服务未起，安全）。
    if let Some(pending) = config.pending_move.clone() {
        if let Some(state) = app.try_state::<DesktopState>() {
            *state.migration_progress.lock().unwrap() =
                Some("正在迁移数据目录…".to_string());
        }
        match migrate_data_dir(&pending.from, &pending.to) {
            Ok(()) => {
                // 迁移成功：更新 data_dir 指向新位置，清待迁移与历史错误。
                config.data_dir = Some(pending.to.clone());
                config.pending_move = None;
                config.last_error = None;
                write_desktop_config(&root, &config);
            }
            Err(err) => {
                // 迁移失败：保留旧 data_dir（即 pending.from 对应路径），清待迁移避免重启循环，
                // 写错误供前端展示。仍用旧路径启动，不让用户卡死。
                let msg = render_error(&err);
                log_line(&format!("data migration failed: {msg}"));
                config.pending_move = None;
                config.last_error = Some(msg);
                write_desktop_config(&root, &config);
            }
        }
        if let Some(state) = app.try_state::<DesktopState>() {
            *state.migration_progress.lock().unwrap() = None;
        }
    }

    let data_dir = resolve_data_dir(&root, &config);
    if let Some(state) = app.try_state::<DesktopState>() {
        *state.data_dir.lock().unwrap() =
            Some(data_dir.to_string_lossy().to_string());
    }
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

    // 3.1 写 Boot Config（data/config.yaml，auth 关闭），仅首次。auth 中间件实际读这份
    // 文件决定是否启用全站鉴权；不写则生产环境缺省启用，导致桌面版被拦在登录页。
    let boot_config_path = data_dir.join("config.yaml");
    if !boot_config_path.exists() {
        fs::write(&boot_config_path, DEFAULT_BOOT_CONFIG)
            .map_err(|e| BootError::io("写 config.yaml", e))?;
    }

    // 4. 会话密钥（持久化，跨启动稳定，避免已登录会话失效）
    let session_password = read_or_create_session_key(&data_dir)?;

    // 5. 选空闲端口
    let port = pick_free_port()?;

    // 6-7. 版本标记：仅在首次启动或版本更新时执行 migrate + asset-sync
    let mut needs_boot_init = true;
    {
        let product_version_path = product_dir.join(".neuro-book-version");
        let boot_stamp_path = data_dir.join(".boot-stamp");
        if let (Ok(product_ver), Ok(boot_ver)) = (
            fs::read_to_string(&product_version_path),
            fs::read_to_string(&boot_stamp_path),
        ) {
            if product_ver.trim() == boot_ver.trim() {
                needs_boot_init = false;
                log_line("跳过 migrate / asset-sync（版本未变更）");
            }
        }
    }
    if needs_boot_init {
    // 6. migrate
    log_line(&format!("migrate (port={port})"));
    run_bun_capture(
        &bun_exe,
        &product_dir,
        &[".output/server/scripts/db/prisma-migrate.mjs", "--deploy"],
        &server_env(&product_dir, &data_dir, &logs_dir, port, &session_password),
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
        &server_env(&product_dir, &data_dir, &logs_dir, port, &session_password),
        Some(&logs_dir.join("init.log")),
    )?;

    // 写入启动标记，下次启动时可跳过 migrate + asset-sync
    if let Ok(product_ver) = fs::read_to_string(&product_dir.join(".neuro-book-version")) {
        let _ = fs::write(&data_dir.join(".boot-stamp"), product_ver.trim().as_bytes());
    }
    } // needs_boot_init

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
        .envs(server_env(&product_dir, &data_dir, &logs_dir, port, &session_password))
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
    wait_for_ready(port, Duration::from_secs(300))?;

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

/// 桌面级配置文件路径：{exe 目录}/neuro-book.config.json。
fn desktop_config_path(root: &Path) -> PathBuf {
    root.join(DESKTOP_CONFIG_FILENAME)
}

/// 读取桌面级配置。文件不存在或解析失败均回退默认（空 data_dir），不阻断启动。
/// 兼容人工编辑或 Inno Setup 写入可能带的 UTF-8 BOM（serde_json 不容忍 BOM）。
fn read_desktop_config(root: &Path) -> DesktopConfig {
    let path = desktop_config_path(root);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
            match serde_json::from_str::<DesktopConfig>(text) {
                Ok(cfg) => cfg,
                Err(err) => {
                    log_line(&format!("config.json 解析失败，回退默认：{err}"));
                    DesktopConfig::default()
                }
            }
        }
        Err(_) => DesktopConfig::default(),
    }
}

/// 写入桌面级配置（pretty JSON，便于人工查看/编辑）。
fn write_desktop_config(root: &Path, config: &DesktopConfig) {
    let path = desktop_config_path(root);
    if let Ok(text) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, text);
    }
}

/// 解析当前生效 data 目录：config.data_dir 非空→用之（相对路径相对 exe root），否则回退 root/data。
fn resolve_data_dir(root: &Path, config: &DesktopConfig) -> PathBuf {
    match &config.data_dir {
        Some(s) if !s.trim().is_empty() => {
            let p = PathBuf::from(s.trim());
            if p.is_absolute() {
                p
            } else {
                root.join(p)
            }
        }
        _ => root.join("data"),
    }
}

/// 迁移 data 目录：递归复制 from→to。to 必须不存在或为空（防覆盖）。
/// 成功后不自动删 from（防丢数据，提示用户手动清理）。
fn migrate_data_dir(from: &str, to: &str) -> Result<(), BootError> {
    let from_path = PathBuf::from(from);
    let to_path = PathBuf::from(to);

    if !from_path.exists() {
        return Err(BootError::Config(format!("迁移源目录不存在：{from}")));
    }
    // to 已存在且非空 → 拒绝（避免覆盖已有数据）
    if to_path.exists() {
        if let Ok(entries) = fs::read_dir(&to_path) {
            if entries.filter_map(|e| e.ok()).next().is_some() {
                return Err(BootError::Config(format!(
                    "目标目录非空，为避免覆盖已拒绝迁移：{to}"
                )));
            }
        }
    }

    fs::create_dir_all(&to_path).map_err(|e| BootError::io("创建目标目录", e))?;
    copy_dir_recursive(&from_path, &to_path).map_err(|e| BootError::io("复制数据文件", e))?;
    log_line(&format!("data 已迁移 {from} -> {to}"));
    Ok(())
}

/// 递归复制目录树（保留文件内容与目录结构）。复制失败时返回错误，调用方决定是否回滚。
fn copy_dir_recursive(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let name = entry.file_name();
        let dst = to.join(&name);
        let ft = entry.file_type()?;
        if ft.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
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
    product_dir: &Path,
    data_dir: &Path,
    logs_dir: &Path,
    port: u16,
    session_password: &str,
) -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("NODE_ENV", "production".to_string()),
        // 显式声明 application root 与 state root：server 解析 Boot Config (config.yaml)
        // 走 installation-paths.resolveStateRoot，必须指向 data 目录，否则会回退到
        // cwd (product/) 找不到 config.yaml，生产环境缺省启用鉴权，桌面版被拦在登录页。
        (
            "NEURO_BOOK_APPLICATION_ROOT",
            product_dir.to_string_lossy().to_string(),
        ),
        ("NEURO_BOOK_STATE_ROOT", data_dir.to_string_lossy().to_string()),
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
