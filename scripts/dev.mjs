import { spawn } from 'node:child_process';

function argValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

const astroArgs = process.argv.slice(2);
const apiPort = process.env.LUME_API_PORT || '4173';
const sitePort = argValue(astroArgs, '--port') || '4321';
const processes = [
  spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }),
  spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', ...astroArgs], { stdio: 'inherit' }),
];

console.log('');
console.log('Lume em desenvolvimento');
console.log(`  Site com HMR: http://localhost:${sitePort}`);
console.log(`  API local:    http://127.0.0.1:${apiPort}`);
console.log('  Abra a URL do site. CSS, React e páginas Astro atualizam em tempo real.');
console.log('  Mudanças em api/ exigem reiniciar o processo. Ctrl+C encerra tudo.');
console.log('');

let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; processes.forEach(child => child.kill()); process.exitCode = code; }
processes.forEach(child => { child.on('error', error => { console.error(error); stop(1); }); child.on('exit', code => stop(code || 0)); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
