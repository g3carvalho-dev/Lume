import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'lume-player-'));
await mkdir(join(dir,'appdata'));
const host = createServer((req,res) => {
  if (req.url.startsWith('/api/extension/lesson?')) {
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({found:true, lessonTitle:'Aula importada', courseTitle:'Curso importado', duration:240}));
  }
  res.setHeader('Content-Type','text/html'); res.end(`<button onclick="window.open(window.lesson, '_blank', 'noopener,noreferrer')">Continuar</button>`);});
await new Promise(done => host.listen(0,'127.0.0.1',done));
const origin = 'http://127.0.0.1:'+host.address().port;
const env = {...process.env, APPDATA:join(dir,'appdata'), XDG_CONFIG_HOME:join(dir,'appdata'), LUME_API_URL:origin};
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  const executablePath = createRequire(new URL('../companion/package.json',import.meta.url))('electron');
  desktop = await electron.launch({executablePath,args:[resolve('companion'),'--user-data-dir='+dir],env});
  const page = await desktop.firstWindow();
  await page.waitForURL(origin+'/**');
  const media = (await readFile('tests/fixtures/watch.webm')).toString('base64');
  await desktop.evaluate(({session}, media) => {
    session.fromPartition('persist:lume-courses').protocol.handle('https', () => new Response('<header><h1>Curso de exemplo</h1><h2 class="line-clamp-2">Aula de exemplo</h2></header><main><div class="video-js" data-purpose="video-player"><video muted autoplay loop src="data:video/webm;base64,'+media+'"></video><button>Pausar</button></div><aside>Grade</aside></main>',{headers:{'Content-Type':'text/html'}}));
  }, media);
  for (const address of ['https://www.udemy.com/course/teste/learn/lecture/1','https://www.grancursosonline.com.br/aluno/curso/video/codigo/teste/v/1']) {
    await page.evaluate(value=>window.lesson=value,address);
    await page.getByText('Continuar').click();
    const started = Date.now();
    let playing = false;
    while (!playing && Date.now()-started<8000) {
      playing = await desktop.evaluate(async ({webContents},url)=>{
        const guest=webContents.getAllWebContents().find(w=>w.getURL()===url);
        return guest && guest.executeJavaScript('document.querySelector("video")?.currentTime > 0 && getComputedStyle(document.querySelector("header")).display === "none" && getComputedStyle(document.querySelector("aside")).display === "none" && document.querySelector("button").offsetWidth > 0 && document.querySelector(".video-js").offsetWidth === innerWidth');
      },address);
      if (!playing) await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(playing,'O vídeo deve tocar dentro do aplicativo');
    const gran = address.includes('grancursos');
    const toolbar = desktop.context().pages().find(p => p.url().includes('/renderer/lesson.html'));
    await toolbar.getByRole('heading', {name:gran ? 'Aula de exemplo' : 'Aula importada'}).waitFor();
    await toolbar.getByText(gran ? 'Curso de exemplo' : 'Curso importado').waitFor();
    await toolbar.getByText(gran ? 'Gran' : 'Udemy', {exact:true}).waitFor();
    await toolbar.waitForFunction(() => /^\d+:\d{2}$/.test(document.getElementById('duration').textContent));
    const stage = await toolbar.locator('.stage').boundingBox();
    const guest = desktop.context().pages().find(p => p.url() === address);
    assert.ok(Math.abs((await guest.evaluate(() => innerWidth)) - stage.width) < 8);
    await desktop.evaluate(async ({webContents})=>{
      const toolbar=webContents.getAllWebContents().find(w=>w.getURL().includes('/renderer/lesson.html'));
      await toolbar.executeJavaScript('document.querySelector("a").click()');
    });
    await page.getByText('Continuar').waitFor();
    assert.equal(await desktop.evaluate(({webContents},url)=>webContents.getAllWebContents().some(w=>w.getURL()===url),address),false);
  }
  console.log('Gran e Udemy: vídeo de teste reproduzido e fechado na mesma janela.');
} finally { if(desktop) await desktop.close(); host.close(); }
