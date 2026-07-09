// NeuroBook Desktop Shell —— Tauri 主进程。
//
// 职责：在本地启动 NeuroBook Nitro 服务（Bun 子进程），等待就绪后让加载页跳转到
// http://localhost:<port>。退出时由进程组（Windows Job Object）连带杀掉服务子进程。
//
// 这里**不**复用 launcher.mjs：launcher 用 @clack/prompts 做交互式终端提示（端口冲突、
// 首次建管理员），GUI 没有终端会卡住。本文件直接编排非交互式启动子集：
//   1. 建数据目录、全局 config（auth.enabled=false 免登录）
//   2. 建 product/workspace -> data/workspace 目录联接
//   3. 选空闲端口
//   4. 跑 prisma migrate --deploy
//   5. 跑 prepare-system-assets --sync-user-assets
//   6. 启动 Nitro 服务（进程组），日志落 data/logs/server.log
//   7. 轮询端口就绪，写入 server_url，由加载页轮询 get_server_url 后跳转

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;

fn main() {
    desktop::run();
}
