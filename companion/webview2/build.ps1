$ErrorActionPreference = 'Stop'
$version = '1.0.4314.35'
$cacheDir = Join-Path $PSScriptRoot "../node_modules/.cache/webview2-$version"
$outputDir = Join-Path $PSScriptRoot '../build/udemy-runtime'
New-Item -ItemType Directory -Force $cacheDir,$outputDir | Out-Null
$zip = Join-Path $cacheDir 'sdk.zip'
if (!(Test-Path -LiteralPath $zip)) {
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $zip
}
$stream = [IO.File]::OpenRead((Resolve-Path $zip).Path)
try { $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose() }
if ($hash -ne '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4') {throw 'O pacote WebView2 não corresponde à versão fixada.'}
$sdk = Join-Path $cacheDir 'sdk'
if (!(Test-Path "$sdk/build/native/include/WebView2.h")) {Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $zip).Path, [IO.Path]::GetFullPath($sdk))}
$electron = (Get-Content (Join-Path $PSScriptRoot '../node_modules/electron/package.json') -Raw | ConvertFrom-Json).version
& (Join-Path $PSScriptRoot '../node_modules/.bin/node-gyp.cmd') rebuild "--directory=$PSScriptRoot" "--target=$electron" --arch=x64 --dist-url=https://electronjs.org/headers
if ($LASTEXITCODE) { throw 'Falha ao compilar o módulo WebView2 para Electron.' }
Copy-Item (Join-Path $PSScriptRoot 'build/Release/lume_webview.node'),"$sdk/LICENSE.txt" -Destination $outputDir
