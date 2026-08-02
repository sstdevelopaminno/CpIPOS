#define AppName "CpIPOS Windows Runtime"
#define AppPublisher "Cutting Point Tech Co., Ltd."
#define AppExeName "Cpipos.WindowsRuntime.exe"

#ifndef AppVersion
#define AppVersion "0.1.1"
#endif

#ifndef SourceDir
#define SourceDir "..\..\..\artifacts\CpIPOS-WindowsRuntime-win-x64"
#endif

#ifndef OutputDir
#define OutputDir "..\..\..\artifacts"
#endif

[Setup]
AppId={{2F5D4FA8-7622-4B4E-9F4C-2F5D4FA80111}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\CpIPOS Windows Runtime
DefaultGroupName=CpIPOS
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=CpIPOS-WindowsRuntime-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName={#AppName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\CpIPOS Windows Runtime"; Filename: "{app}\{#AppExeName}"
Name: "{userdesktop}\CpIPOS Windows Runtime"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch CpIPOS Windows Runtime"; Flags: nowait postinstall skipifsilent
