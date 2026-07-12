; NeuroBook Desktop Installer — Inno Setup 6 脚本。
;
; 把 dist/neuro-book-desktop-x64/ portable 文件夹打包为 setup.exe，
; 提供安装路径选择、data 目录选择、快捷方式创建和标准卸载程序。
;
; 编译流程：
;   1. bun run desktop:assemble          （生成 portable 文件夹）
;   2. bun scripts/deploy/build-setup.mjs （暂存到短路径 + 编译 setup.exe）
;
; 或手动编译（需先把 portable 复制到 C:\nb\s）：
;   NEURO_BOOK_VERSION=0.6.0 "ISCC.exe" scripts/deploy/neuro-book-setup.iss

#define SourceRoot "C:\nb\s"
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

; 卸载清理安装时写的桌面配置；data 目录（运行时产生，非安装文件）不主动删，
; 仅当安装目录下 data 为空时清理空目录。用户自选位置的 data 完全保留。
[UninstallDelete]
Type: files; Name: "{app}\neuro-book.config.json"
Type: dirifempty; Name: "{app}\data"

; ---------------------------------------------------------------------
; data 目录选择页：让用户选 data 落点（可非 C 盘），写进 neuro-book.config.json。
; desktop.rs 启动时读该配置定位 data 目录。
; ---------------------------------------------------------------------
[Code]
var
  DataDirPage: TInputDirWizardPage;

procedure InitializeWizard;
begin
  // data 目录选择页，插在选择程序组页之后
  DataDirPage := CreateInputDirPage(wpSelectProgramGroup,
    '选择数据目录',
    'NeuroBook 的数据（小说、数据库、生成图片）将存放在此目录',
    '可选择非系统盘以节省 C 盘空间，安装后仍可在应用内设置中更改：',
    False, '');
  DataDirPage.Add('数据目录');
  DataDirPage.Values[0] := ExpandConstant('{autopf}\NeuroBook\data');
end;

// 构造 config JSON，路径反斜杠转义（JSON 字符串要求）
function BuildConfigJson(DataDir: string): string;
var
  Escaped: string;
begin
  Escaped := DataDir;
  StringChangeEx(Escaped, '\', '\\', True);
  Result := '{"dataDir":"' + Escaped + '"}';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, Json: string;
  Lines: array of string;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\neuro-book.config.json');
    Json := BuildConfigJson(DataDirPage.Values[0]);
    // SaveStringsToUTF8File 写 UTF-8 无 BOM；desktop.rs 已 strip BOM 兼容
    SetArrayLength(Lines, 1);
    Lines[0] := Json;
    SaveStringsToUTF8File(ConfigPath, Lines, False);
  end;
end;
