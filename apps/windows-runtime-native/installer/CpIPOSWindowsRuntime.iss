#define AppName "CpIPOS"
#define AppPublisher "Cutting Point Tech Co., Ltd."
#define AppExeName "Cpipos.WindowsRuntime.exe"
#define AppIconName "cpipos.ico"

#ifndef AppVersion
#define AppVersion "0.1.6"
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
AppId={{2F5D4FA8-7622-4B4E-9F4C-2F5D4FA80111}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\CpIPOS
DefaultGroupName=CpIPOS
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=CpIPOS-WindowsRuntime-Setup
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
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
Type: files; Name: "{userdesktop}\CpIPOS.lnk"
Type: files; Name: "{userdesktop}\CpIPOS Windows Runtime.lnk"
Type: files; Name: "{userdesktop}\CpIpOS Mobile.lnk"
Type: files; Name: "{userdesktop}\CpIPOS Mobile.lnk"
Type: files; Name: "{group}\CpIPOS.lnk"
Type: files; Name: "{group}\CpIPOS Windows Runtime.lnk"
Type: files; Name: "{group}\CpIpOS Mobile.lnk"
Type: files; Name: "{group}\CpIPOS Mobile.lnk"
Type: files; Name: "{app}\cpipos.ico"
Type: files; Name: "{app}\assets\cpipos.ico"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#IconFile}"; DestDir: "{app}"; DestName: "{#AppIconName}"; Flags: ignoreversion
Source: "{#IconFile}"; DestDir: "{app}\assets"; DestName: "{#AppIconName}"; Flags: ignoreversion

[Icons]
Name: "{group}\CpIPOS"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0
Name: "{userdesktop}\CpIPOS"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\{#AppIconName}"; IconIndex: 0; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch CpIPOS"; Flags: nowait postinstall skipifsilent
