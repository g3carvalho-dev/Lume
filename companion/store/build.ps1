$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot/..")
$kit = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/makeappx.exe" |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (!$kit) { throw 'Instale o Windows SDK com o MakeAppx para gerar o MSIX.' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
& npm.cmd run pack -- --x64 --config.directories.output=release-build/store
if ($LASTEXITCODE) { throw 'Falha ao empacotar o Lume Desktop.' }
$stage = (Resolve-Path 'release-build/store/win-unpacked').Path
if (!(Test-Path "$stage/resources/webview2/lume_webview.node")) { throw 'Módulo do player ausente.' }
New-Item "$stage/resources/microsoft-store" -ItemType File -Force | Out-Null
[xml]$manifest = Get-Content "$PSScriptRoot/AppxManifest.xml" -Encoding UTF8 -Raw
$manifest.Package.Identity.Version = "$version.0"
$manifest.Save("$stage/AppxManifest.xml")
Add-Type -AssemblyName System.Drawing
$assets = New-Item "$stage/Assets" -ItemType Directory -Force
$icon = [Drawing.Image]::FromFile((Resolve-Path 'build/icon.png').Path)
try {
    foreach ($logo in @{StoreLogo=50; Square150=150; Square44=44}.GetEnumerator()) {
        $bitmap = [Drawing.Bitmap]::new($icon, $logo.Value, $logo.Value)
        try { $bitmap.Save("$assets/$($logo.Key).png", [Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
    }
} finally { $icon.Dispose() }
$out = New-Item 'release' -ItemType Directory -Force
& $kit.FullName pack /o /d $stage /p "$out/Lume-Academy-$version-x64.msix"
if ($LASTEXITCODE) { throw 'O MakeAppx recusou o pacote.' }
