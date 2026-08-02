# CpIPOS Windows Native Runtime

This folder contains the native Windows runtime for CpIPOS POS terminal field testing.

## Project

```text
apps/windows-runtime-native/Cpipos.WindowsRuntime/Cpipos.WindowsRuntime.csproj
```

## Build locally on Windows with .NET 8 SDK

```powershell
dotnet publish apps/windows-runtime-native/Cpipos.WindowsRuntime/Cpipos.WindowsRuntime.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o artifacts/CpIPOS-WindowsRuntime-win-x64
```

## Run

```powershell
.\Cpipos.WindowsRuntime.exe
.\Cpipos.WindowsRuntime.exe --printer="MTP-II"
.\Cpipos.WindowsRuntime.exe --windowed
```

The EXE includes a native local print bridge at `http://127.0.0.1:3210`.
