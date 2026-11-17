// Capturas da ficha da Chrome Web Store (1280x800) com o popup e o selo REAIS da extensão.
// Serve a raiz do repositório, injeta um `chrome` de mentira e fotografa as cenas.
// Uso: node scripts/build-extension-store.mjs [pasta de saída]
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const out = resolve(process.argv[2] || 'extension/store');
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === '/_scene') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(sceneHtml(url.searchParams.get('s'))); return; }
    if (path === '/_lesson') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(lessonHtml()); return; }
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error('fora');
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
}).listen(4395);

const STAR = '<svg width="34" height="34" viewBox="0 0 64 64"><path d="M32 4 L37.6 26.4 L60 32 L37.6 37.6 L32 60 L26.4 37.6 L4 32 L26.4 26.4 Z" fill="#f6c165"/></svg>';
const SCENES = {
  leitura: { kicker: 'Leitor de curso', title: 'Leve o curso para o Lume <em>em um clique</em>', lead: 'Abra a grade na plataforma, com a sua conta, e leia. Você revisa tudo no Lume antes de adicionar.', bullets: ['Disciplinas, aulas, durações e o que já está concluído', 'Gran, Udemy e outras plataformas de cursos'], kind: 'popup' },
  plataformas: { kicker: 'Você no controle', title: 'Cada plataforma <em>só com a sua permissão</em>', lead: 'O acompanhamento fica desligado até você ligar, plataforma por plataforma, e pode ser revogado quando quiser.', bullets: ['Permissão pedida ao ligar cada plataforma', 'Nada é lido nos sites que você não autorizou'], kind: 'popup' },
  acompanhar: { kicker: 'Acompanhar aulas', title: 'Veja onde você está <em>no curso</em>', lead: 'O painel mostra a aula atual, o avanço em aulas e módulos e quanto você estudou hoje.', bullets: ['Aula atual e progresso do curso', 'Tempo de estudo do dia'], kind: 'popup' },
  selo: { kicker: 'Selo na página', title: 'O tempo conta <em>enquanto você assiste</em>', lead: 'Um selo discreto mostra a aula e o cronômetro. A aula é concluída quando a plataforma marcar.', bullets: ['Recolha o selo quando quiser', 'Só mede duração, tempo tocado e conclusão'], kind: 'page' },
  miniplayer: { kicker: 'Miniplayer', title: 'Assista <em>sem sair da tela</em>', lead: 'Reduza o player para um canto da página ou abra a janela flutuante sobre o Lume.', bullets: ['Esc devolve o player ao tamanho original', 'O vídeo continua na plataforma'], kind: 'page' },
};

function sceneHtml(name) {
  const s = SCENES[name];
  const visual = s.kind === 'popup'
    ? `<div class="pop"><iframe id="f" src="/extension/popup.html?scene=${name}" width="360" height="420" scrolling="no"></iframe></div>`
    : `<div class="browser"><div class="bar"><i></i><i></i><i></i><span>grancursosonline.com.br/aula/12</span></div><iframe src="/_lesson" width="560" height="400"></iframe></div>`;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'Bricolage Grotesque';font-weight:500 800;src:url('/extension/fonts/bricolage-grotesque-latin.woff2')}
@font-face{font-family:'Atkinson Hyperlegible Next';font-weight:400 700;src:url('/extension/fonts/atkinson-hyperlegible-next-latin.woff2')}
@font-face{font-family:'JetBrains Mono';font-weight:400 700;src:url('/extension/fonts/jetbrains-mono-latin.woff2')}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:800px;display:flex;align-items:center;justify-content:space-between;padding:0 80px;background:#0c111b;color:#eef2f7;font-family:'Atkinson Hyperlegible Next',sans-serif;background-image:radial-gradient(#26324d 1.2px,transparent 1.4px);background-size:28px 28px}
.brand{display:flex;align-items:center;gap:12px;font:700 26px 'Bricolage Grotesque'}
.brand small{font:500 12px 'JetBrains Mono';letter-spacing:.08em;text-transform:uppercase;color:#9aa7ba;margin-left:6px}
h1{margin-top:40px;font:700 50px/1.05 'Bricolage Grotesque';letter-spacing:-.02em;max-width:470px}
em{font-style:normal;color:#f6c165}
.lead{margin-top:22px;font-size:21px;line-height:1.5;color:#c3ccda;max-width:450px}
ul{margin-top:28px;padding:0;list-style:none;display:grid;gap:12px;font-size:18px}
li{display:flex;align-items:center;gap:14px}li::before{content:'';width:9px;height:9px;border-radius:50%;background:#9ec5ff;flex:none}
.pop,.browser{flex:none}.pop{zoom:.86;border:1px solid #3a4868;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px #0008;margin-right:40px;background:#0c111b}
.pop iframe,.browser iframe{display:block;border:0}
.browser{border:1px solid #3a4868;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px #0008;background:#0c111b}
.bar{height:36px;display:flex;align-items:center;gap:7px;padding:0 14px;background:#141b2a;border-bottom:1px solid #2a3550}
.bar i{width:10px;height:10px;border-radius:50%;background:#3a4868}.bar span{margin-left:12px;font:12px 'JetBrains Mono';color:#9aa7ba}
</style><div><div class="brand">${STAR} Lume <small>${s.kicker}</small></div><h1>${s.title}</h1><p class="lead">${s.lead}</p><ul>${s.bullets.map((b) => `<li>${b}</li>`).join('')}</ul></div>${visual}`;
}

// Página de aula de mentira (identidade neutra) onde o selo real é montado.
function lessonHtml() {
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:100vw;height:100vh;background:#101522;color:#e6e9f0;font-family:system-ui,sans-serif;overflow:hidden}
.top{height:44px;background:#1a2133;display:flex;align-items:center;padding:0 16px;font-weight:600;font-size:14px;border-bottom:1px solid #262f45}
.main{display:grid;grid-template-columns:1fr 150px;height:calc(100vh - 44px)}
.stage{padding:14px}.video-js{width:100%;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden}.video-js video{width:100%;height:100%;display:block}
h2{font-size:15px;margin-top:12px}p{font-size:12px;color:#8e99b3;margin-top:4px}
.side{background:#141a2b;border-left:1px solid #262f45;padding:12px;font-size:12px;display:grid;gap:8px;align-content:start}.side div{padding:8px;border-radius:6px;background:#1a2133}.side .on{background:#26457a}
</style><div class="top">Curso de Direito Constitucional</div><div class="main"><div class="stage"><div class="video-js"><video id="v" muted playsinline></video></div><h2>Aula 12 · Controle de constitucionalidade</h2><p>Módulo 3 · 38 min</p></div><div class="side"><div>10 · Poder Legislativo</div><div>11 · Poder Executivo</div><div class="on">12 · Controle de constitucionalidade</div><div>13 · Súmulas vinculantes</div><div>14 · Revisão do módulo</div></div></div>
<script type="module">
import { watchBadge } from '/extension/src/watch-badge.js';
const v = document.getElementById('v');
const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
const g = c.getContext('2d');
let t = 0;
const draw = () => { t++; const gr = g.createLinearGradient(0, 0, 640, 360); gr.addColorStop(0, '#1d2f5a'); gr.addColorStop(1, '#3a2a5c'); g.fillStyle = gr; g.fillRect(0, 0, 640, 360); g.fillStyle = '#ffffffdd'; g.font = '600 34px system-ui'; g.fillText('Controle de', 40, 150); g.fillText('constitucionalidade', 40, 195); g.fillStyle = '#f6c165'; g.fillRect(40, 320, 20 + (t % 300), 4); };
draw(); setInterval(draw, 100);
v.srcObject = c.captureStream(10); await v.play().catch(() => {});
const badge = watchBadge();
const now = Date.now();
badge.show({ stepId: 's12', index: 12, stats: { total: 48, completed: 11 }, completed: false, login: false,
  session: { origin: 'watching', stepId: 's12', status: 'active', startedAt: new Date(now - 754000).toISOString(), lastTickAt: new Date(now).toISOString(), accumulatedMs: 754000 } }, v);
window.ready = true;
</script>`;
}

// `chrome` de mentira, lido por popup.js e pelo selo; o shadow root do selo fica aberto para o clique.
const stub = () => {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }); };
  const scene = new URLSearchParams(location.search).get('scene');
  const on = scene === 'plataformas' || scene === 'acompanhar' ? ['grancursosonline.com.br', 'udemy.com', 'alura.com.br'] : scene === 'leitura' ? ['grancursosonline.com.br'] : [];
  const store = {};
  window.chrome = {
    runtime: {
      getURL: (p) => '/extension/' + p,
      getManifest: () => ({ host_permissions: ['https://lumeacademy.site/*', 'http://localhost:4173/*'] }),
      onMessage: { addListener() {} },
      sendMessage: async (m) => {
        if (m?.type === 'watch-panel') {
          const base = { account: { login: false, name: 'Conectado ao Lume como Marina Souza' } };
          return scene === 'acompanhar'
            ? { ...base, found: true, lessonTitle: 'Controle de constitucionalidade', session: { status: 'active' }, lesson: { completed: false }, index: 12, stats: { total: 48, completed: 11, modules: { completed: 2, total: 6 }, todayMinutes: 47 }, estimate: 'Faltam cerca de 9 h' }
            : base;
        }
        return { ok: true };
      },
    },
    tabs: { query: async () => [{ id: 1, url: 'https://www.grancursosonline.com.br/aluno/curso/1', title: 'Curso' }] },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
    permissions: { contains: async ({ origins }) => origins.every((o) => on.some((h) => o.includes('*.' + h + '/'))), request: async () => true, remove: async () => true },
    scripting: { executeScript: async () => [] },
  };
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL === 'bundled' ? undefined : 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(stub);
let n = 0;
for (const name of Object.keys(SCENES)) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4395/_scene?s=${name}`);
  await page.waitForTimeout(2500);
  if (SCENES[name].kind === 'popup') {
    const frame = page.frames().find((f) => f.url().includes('popup.html'));
    await frame.evaluate(() => document.querySelector('[data-dev]')?.remove());
    if (name === 'leitura') await frame.evaluate(() => { document.getElementById('status').textContent = 'Encontrei 427 aulas, 3 concluídas. Enviando ao Lume…'; });
    const height = await frame.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate((h) => { document.getElementById('f').height = h; }, height);
  } else if (name === 'miniplayer') {
    const frame = page.frames().find((f) => f.url().includes('_lesson'));
    await frame.waitForFunction(() => window.ready);
    await frame.locator('.on-page').click();
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/captura-${++n}-${name}.png` });
  console.log('captura', n, name);
  await page.close();
}
await browser.close(); server.close();
