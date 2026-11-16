// Gera os ícones da extensão e as imagens da ficha da loja na identidade Norte
// (estrela dourada de quatro pontas sobre a noite #0c111b). Uso: node scripts/build-extension-assets.mjs
// Renderiza HTML com o Chromium do Playwright; as fontes vêm de extension/fonts/.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ext = join(root, 'extension');
const fontUrl = (name) => `data:font/woff2;base64,${readFileSync(join(ext, 'fonts', name)).toString('base64')}`;
mkdirSync(join(ext, 'icons'), { recursive: true });
mkdirSync(join(ext, 'store'), { recursive: true });

const STAR = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M32 4 L37.6 26.4 L60 32 L37.6 37.6 L32 60 L26.4 37.6 L4 32 L26.4 26.4 Z" fill="#f6c165"/></svg>`;
const FONTS = `
  @font-face { font-family: 'Bricolage Grotesque'; font-weight: 500 800; src: url('${fontUrl('bricolage-grotesque-latin.woff2')}'); }
  @font-face { font-family: 'Atkinson Hyperlegible Next'; font-weight: 400 700; src: url('${fontUrl('atkinson-hyperlegible-next-latin.woff2')}'); }
  @font-face { font-family: 'JetBrains Mono'; font-weight: 400 700; src: url('${fontUrl('jetbrains-mono-latin.woff2')}'); }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0c111b; color: #eef2f7; font-family: 'Atkinson Hyperlegible Next', sans-serif; }`;

const icon = (size) => `<style>${FONTS} body { width:${size}px; height:${size}px; background:transparent; display:grid; place-items:center; }
  .tile { width:${size}px; height:${size}px; border-radius:${Math.round(size * 0.25)}px; background:#0c111b; display:grid; place-items:center; }</style>
  <div class="tile">${STAR(Math.round(size * 0.62))}</div>`;

const promo = `<style>${FONTS} body { width:440px; height:280px; padding:32px; background:#0c111b;
  background-image: radial-gradient(#26324d 1px, transparent 1.2px); background-size: 18px 18px; }
  .brand { display:flex; align-items:center; gap:10px; font: 700 22px 'Bricolage Grotesque'; }
  h1 { margin-top: 38px; font: 700 34px/1.08 'Bricolage Grotesque'; letter-spacing:-.015em; max-width: 360px; }
  p { margin-top: 14px; font-size: 15px; line-height:1.45; color:#c3ccda; max-width: 340px; }
  em { font-style:normal; color:#f6c165; }</style>
  <div class="brand">${STAR(30)} Lume</div>
  <h1>Seu curso no Lume, <em>em um clique</em></h1>
  <p>Aulas e progresso lidos da página aberta com a sua conta.</p>`;

const shot = `<style>${FONTS} body { width:1280px; height:800px; display:flex; align-items:center; justify-content:space-between; padding:0 110px;
  background-image: radial-gradient(#26324d 1.2px, transparent 1.4px); background-size: 28px 28px; }
  .brand { display:flex; align-items:center; gap:12px; font: 700 26px 'Bricolage Grotesque'; }
  .brand small { font: 500 12px 'JetBrains Mono'; letter-spacing:.08em; text-transform:uppercase; color:#9aa7ba; margin-left:6px; }
  h1 { margin-top: 44px; font: 700 60px/1.04 'Bricolage Grotesque'; letter-spacing:-.02em; max-width: 600px; }
  em { font-style:normal; color:#f6c165; }
  .lead { margin-top: 22px; font-size: 22px; line-height:1.5; color:#c3ccda; max-width: 560px; }
  ul { margin-top: 30px; padding:0; list-style:none; display:grid; gap:12px; font-size:19px; }
  li { display:flex; align-items:center; gap:14px; }
  li::before { content:''; width:9px; height:9px; border-radius:50%; background:#9ec5ff; }
  .pop { width:340px; padding:18px; background:#0c111b; border:1px solid #3a4868; border-radius:14px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
  .pop header { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .pop h2 { font: 700 18px 'Bricolage Grotesque'; }
  .pop .tag { margin-left:auto; font: 500 10px 'JetBrains Mono'; letter-spacing:.06em; text-transform:uppercase; color:#9aa7ba; }
  .pop p { font-size:13px; line-height:1.5; color:#c3ccda; margin-bottom:12px; }
  .btn { padding:10px 12px; border-radius:10px; font-weight:700; font-size:14px; text-align:center; background:#f6c165; color:#1f1503; }
  .btn.s { margin-top:8px; background:transparent; color:#eef2f7; border:1px solid #3a4868; font-weight:500; }
  .st { margin-top:12px; padding:8px 10px; border-radius:8px; background:#141b2a; border:1px solid #2a3550; font-size:13px; }
  .st b { font-family:'JetBrains Mono'; color:#f6c165; font-weight:600; }</style>
  <div>
    <div class="brand">${STAR(36)} Lume <small>Leitor de curso</small></div>
    <h1>Leve o seu curso para o Lume <em>em um clique</em></h1>
    <p class="lead">Abra o curso na plataforma, com a sua conta, e envie a lista de aulas para revisar no Lume.</p>
    <ul><li>Disciplinas, aulas, durações e o que já foi concluído</li><li>Você revisa antes de adicionar; nada entra sozinho</li><li>Não lê senha, cookie nem vídeo</li></ul>
  </div>
  <div class="pop">
    <header>${STAR(28)}<h2>Lume</h2><span class="tag">Leitor de curso</span></header>
    <p>Abra a lista de aulas do curso na plataforma, com a sua conta, e clique em Ler. O Lume recebe os nomes das aulas e o que aparece como concluído.</p>
    <div class="btn">Ler esta página e enviar</div><div class="btn s">Concluí esta aula</div>
    <div class="st">Encontrei <b>427</b> aulas, <b>3</b> concluídas. Enviando ao Lume…</div>
  </div>`;

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL === 'bundled' ? undefined : 'chrome' });
async function render(html, width, height, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ext, file), omitBackground: transparent });
  await page.close();
}
for (const size of [16, 32, 48, 128]) await render(icon(size), size, size, `icons/icon-${size}.png`, true);
await render(promo, 440, 280, 'store/promo-440x280.png');
await render(shot, 1280, 800, 'store/captura-1280x800.png');
await browser.close();
console.log('Ícones e imagens da loja gerados em extension/.');
