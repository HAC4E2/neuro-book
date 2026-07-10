; NeuroBook Desktop Installer — Inno Setup 6 脚本。
;
; 把 dist/neuro-book-desktop-x64/ portable 文件夹打包为 setup.exe，
; 提供安装路径选择、快捷方式创建和标准卸载程序。
;
; 编译流程：
;   1. bun run desktop:assemble          （生成 portable 文件夹）
;   2. bun scripts/deploy/build-setup.mjs （暂存到短路径 + 编译 setup.exe）
;
; 或手动编译（需先把 portable 复制到 C:\temp\nb-setup\source）：
;   NEURO_BOOK_VERSION=0.5.7 "ISCC.exe" scripts/deploy/neuro-book-setup.iss

#define SourceRoot "C:\temp\nb-setup\source"
#define RepoRoot   "C:\Users\admir\Desktop\Pi\neuro-book"

[Setup]
AppId={{B3C7D2E1-9A4F-4E5D-8C1B-3F6A7E2D4C8B}
AppName=NeuroBook
AppVersion={#GetEnv('NEURO_BOOK_VERSION')}
AppPublisher=HAC4E2
AppPublisherURL=https://github.com/HAC4E2/neuro-book
AppSupportURL=https://github.com/HAC4E2/neuro-book/issues

DefaultDirName={autopf}\NeuroBook
DefaultGroupName=NeuroBook

WizardStyle=modern
SetupIconFile={#RepoRoot}\src-tauri\icons\icon.ico
OutputDir={#RepoRoot}\dist
OutputBaseFilename=NeuroBook-Setup
Compression=lzma2/max
SolidCompression=yes

PrivilegesRequired=lowest
ShowLanguageDialog=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "Create desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startmenuicon"; Description: "Create Start Menu shortcut"; GroupDescription: "Additional icons:"

; 源文件从短路径暂存读取（避免 Windows 260 字符 MAX_PATH 限制）
[Files]
Source: "{#SourceRoot}\NeuroBook.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\product\*"; DestDir: "{app}\product"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.map,node_modules\.bin\*,*.d.ts,*.bunx"
Source: "{#SourceRoot}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\desktop-release.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\NeuroBook"; Filename: "{app}\NeuroBook.exe"; Tasks: startmenuicon
Name: "{group}\Uninstall NeuroBook"; Filename: "{uninstallexe}"; Tasks: startmenuicon
Name: "{autodesktop}\NeuroBook"; Filename: "{app}\NeuroBook.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\NeuroBook.exe"; Description: "Launch NeuroBook"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: dirifempty; Name: "{app}\data"
