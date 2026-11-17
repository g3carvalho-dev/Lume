// Gera os logotipos e a arte hero da listagem da Microsoft Store a partir da estrela do Lume.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] || 'output/store/logos');
await mkdir(out, { recursive: true });
import { readFileSync } from 'node:fs';
const font = 'data:font/woff2;base64,' + readFileSync('public/assets/fonts/bricolage-grotesque-latin.woff2').toString('base64');
const star = (c = '#f6c165') => `<svg viewBox="0 0 64 64"><path d="M32 8 L36.6 27.4 L56 32 L36.6 36.6 L32 56 L27.4 36.6 L8 32 L27.4 27.4 Z" fill="${c}"/></svg>`;
// [arquivo, largura, altura, layout]
const items = [
  ['poster-9x16-720x1080', 720, 1080, 'poster'], ['poster-9x16-1440x2160', 1440, 2160, 'poster'],
  ['caixa-1x1-1080x1080', 1080, 1080, 'box'], ['caixa-1x1-2160x2160', 2160, 2160, 'box'],
  ['icone-300x300', 300, 300, 'icon'], ['icone-150x150', 150, 150, 'icon'], ['icone-71x71', 71, 71, 'icon'],
  ['hero-16x9-1920x1080', 1920, 1080, 'hero'], ['hero-16x9-3840x2160', 3840, 2160, 'hero'],
  ['xbox-chave-584x800', 584, 800, 'poster'], ['xbox-hero-titulo-1920x1080', 1920, 1080, 'hero'], ['xbox-destaque-1080x1080', 1080, 1080, 'box'],
];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
for (const [name, w, h, kind] of items) {
  const u = Math.min(w, h);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const small = kind === 'icon';
  const starSize = small ? u * 0.78 : kind === 'hero' ? u * 0.34 : u * (kind === 'poster' ? 0.5 : 0.46) * (kind === 'poster' ? w / u : 1);
  const showText = !small;
  const textSize = kind === 'hero' ? u * 0.13 : (kind === 'poster' ? w * 0.2 : u * 0.15);
  const tag = kind === 'hero' ? 'Seu norte para provas, trabalhos e entregas.' : kind === 'icon' ? '' : 'Seu norte para provas,<br>trabalhos e entregas.';
  await page.setContent(`<style>
@font-face{font-family:B;src:url('${font}')}
*{margin:0;box-sizing:border-box}
body{width:${w}px;height:${h}px;background:radial-gradient(circle at 50% 38%,#18223a 0,#0c111b 62%);display:flex;flex-direction:${kind === 'hero' ? 'row' : 'column'};align-items:center;justify-content:center;gap:${u * 0.04}px;font-family:B,'Bricolage Grotesque',sans-serif;color:#f5f1e8;text-align:${kind === 'hero' ? 'left' : 'center'};overflow:hidden;
background-image:radial-gradient(#ffffff14 1.2px,transparent 1.4px),radial-gradient(circle at 50% 38%,#18223a 0,#0c111b 62%);background-size:${u * 0.04}px ${u * 0.04}px,100% 100%}
svg{width:${starSize}px;height:${starSize}px;filter:drop-shadow(0 0 ${u * 0.05}px #f6c16555)}
h1{font-size:${textSize}px;font-weight:800;letter-spacing:-.03em;line-height:1}
p{font-size:${u * (kind === 'hero' ? 0.03 : 0.035)}px;color:#aeb7c8;font-family:sans-serif;margin-top:${u * 0.02}px;line-height:1.3}
</style>${star()}${showText ? `<div><h1>Lume</h1><p>${tag}</p></div>` : ''}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}
await browser.close();
console.log('ok');
