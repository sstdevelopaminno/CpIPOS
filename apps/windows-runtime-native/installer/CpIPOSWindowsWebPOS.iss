; Dedicated online Web POS installer. It runs the existing Windows Runtime
; executable in WebView2 mode without replacing the separate offline desktop POS.
#define AppName "CpIPOS Windows Web POS"
#define AppPublisher "CUTTING POINT INNOVATION"
#define AppExeName "Cpipos.WindowsRuntime.exe"
#define AppIconName "cpipos.ico"

#ifndef AppVersion
#define AppVersion "0.2.1"
#endif

#ifndef SourceDir
#define SourceDir "..\..\..\artifacts\CpIPOS-WindowsRuntime-win-x64"
#endif

#ifndef OutputDir
#define OutputDir "..\..\..\artifacts"
#endif

#ifndef IconFile
#define IconFile "..\Cpipos.WindowsRuntime\assets\cpipos.ico"
#endif

[Setup]
AppId={{EB92060E-3D31-4A59-8D72-478C193B9A7D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\CpIPOS-WindowsWebPOS
DefaultGroupName=CpIPOS Windows Web POS
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=CpIPOS-WindowsWebPOS-Setup
SetupIconFile={#IconFile}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\assets\{#AppIconName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#IconFile}"; DestDir: "{app}"; DestName: "{#AppIconName}"; Flags: ignoreversion
Source: "{#IconFile}"; DestDir: "{app}\assets"; DestName: "{#AppIconName}"; Flags: ignoreversion

[Icons]
Name: "{group}\CpIPOS Windows Web POS"; Filename: "{app}\{#AppExeName}"; Parameters: "--legacy-web-pos --windowed"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0
Name: "{userdesktop}\CpIPOS Windows Web POS"; Filename: "{app}\{#AppExeName}"; Parameters: "--legacy-web-pos --windowed"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Run]
Filename: "{app}\{#AppExeName}"; Parameters: "--legacy-web-pos --windowed"; Description: "Launch CpIPOS Windows Web POS"; Flags: nowait postinstall skipifsilent
