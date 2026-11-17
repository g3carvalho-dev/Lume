import { execFileSync } from 'node:child_process';

if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File','webview2/build.ps1'], {stdio:'inherit',windowsHide:true});
}
