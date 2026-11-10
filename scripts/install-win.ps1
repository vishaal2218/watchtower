# Install the extension for Premiere Pro / After Effects on Windows.
#
#   .\scripts\install-win.ps1          system-wide (C:\Program Files\Common Files\...), run as administrator
#   .\scripts\install-win.ps1 -User    this user only (%APPDATA%\Adobe\CEP\extensions), no admin
#   add -Debug to also install .debug (Chrome DevTools on localhost ports 8088-8095)
param(
  [switch]$User,
  [switch]$Debug
)
$ErrorActionPreference = 'Stop'

$BundleId = 'watchtower.replica'
$Src = Split-Path -Parent $PSScriptRoot
if ($User) {
  $DestRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
} else {
  $DestRoot = Join-Path $env:CommonProgramFiles 'Adobe\CEP\extensions'
}
$Dest = Join-Path $DestRoot $BundleId

New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($item in 'CSXS', 'client', 'host', 'lib') {
  Copy-Item -Recurse -Force (Join-Path $Src $item) $Dest
}
if ($Debug) { Copy-Item -Force (Join-Path $Src '.debug') $Dest }

# The build is not signed, so CEP must be told to load unsigned extensions.
foreach ($v in 9..12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Force -Path $key | Out-Null
  Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1'
}

Write-Host "Installed to: $Dest"
Write-Host 'Restart Premiere Pro / After Effects, then open Window > Extensions > Watchtower.'
