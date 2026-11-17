import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

async function assertEventually(check) {
  const deadline = Date.now()+8000;
  while (!check() && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,50));
  assert.ok(check(), String(check));
}

const dir = await mkdtemp(join(tmpdir(), 'lume-player-'));
await mkdir(join(dir,'appdata'));
const events = [];
const host = createServer(async (req,res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/extension/')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const match = {found:true, courseId:'curso', stepId:'aula', videoKey:'video', lesson:{completed:false}};
    if (req.url.endsWith('/watch')) events.push(payload);
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify(match));
  }
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
  desktop = await electron.launch({executablePath,args:[resolve('companion'),'--lume-test-electron-player','--user-data-dir='+dir],env});
  desktop.context().setDefaultTimeout(10000);
  const page = await desktop.firstWindow();
  await page.waitForURL(origin+'/**');
  const media = (await readFile('tests/fixtures/watch.webm')).toString('base64');
  await desktop.evaluate(({session}, media) => {
    session.fromPartition('persist:lume-courses').protocol.handle('https', () => new Response('<header><h1>Curso de exemplo</h1><h2 class="line-clamp-2">Aula de exemplo</h2></header><main><div class="video-js" data-purpose="video-player"><video muted autoplay loop src="data:video/webm;base64,'+media+'"></video><button style="position:absolute;bottom:12px;right:12px">Tela cheia</button></div><aside>Grade</aside></main>',{headers:{'Content-Type':'text/html'}}));
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
    const footer = await toolbar.locator('footer').boundingBox();
    assert.ok(stage.y + stage.height < footer.y);
    assert.ok(footer.y + footer.height < await toolbar.evaluate(() => innerHeight));
    assert.ok(Math.abs(stage.width / stage.height - 16/9) < .01);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement,'::after').height), '36px');
    const nav = desktop.context().pages().find(p => p.url().includes('/renderer/lesson-nav.html'));
    assert.equal(await nav.evaluate(() => innerHeight), 36);
    assert.equal(await nav.evaluate(() => innerWidth), await toolbar.evaluate(() => innerWidth-150));
    const eventFor = state => events.some(e => e.pageUrl === address && e.state === state);
    await assertEventually(() => eventFor('playing'));
    await guest.locator('video').evaluate(v => v.pause());
    await assertEventually(() => events.at(-1)?.state === 'paused');
    await guest.locator('video').evaluate(v => v.play());
    await assertEventually(() => events.at(-1)?.state === 'playing');
    await guest.locator('button').evaluate(button => button.onclick = () => button.parentElement.requestFullscreen());
    await guest.locator('button').click();
    await guest.waitForFunction(() => document.fullscreenElement && innerHeight === screen.height);
    await desktop.evaluate(({webContents}, url) => {
      const player = webContents.getAllWebContents().find(w => w.getURL() === url);
      player.focus();
      player.sendInputEvent({type:'keyDown', keyCode:'Escape'});
      player.sendInputEvent({type:'keyUp', keyCode:'Escape'});
    }, address);
    await guest.waitForFunction(() => !document.fullscreenElement);
    await guest.waitForFunction(width => Math.abs(innerWidth-width)<8, stage.width);
    const nextAddress = address.replace(/1$/, '2');
    await guest.evaluate(url => history.pushState({}, '', url), nextAddress);
    await assertEventually(() => eventFor('ended') && events.some(e => e.pageUrl === nextAddress && e.state === 'playing'));
    await desktop.evaluate(async ({webContents})=>{
      const toolbar=webContents.getAllWebContents().find(w=>w.getURL().includes('/renderer/lesson-nav.html'));
      await toolbar.executeJavaScript('document.querySelector("a").click()');
    });
    await assertEventually(() => events.some(e => e.pageUrl === nextAddress && e.state === 'ended'));
    await page.getByText('Continuar').waitFor();
    assert.equal(await desktop.evaluate(({webContents},url)=>webContents.getAllWebContents().some(w=>w.getURL()===url),address),false);
  }
  const loginLesson = 'https://www.udemy.com/course/teste/learn/lecture/3';
  await desktop.evaluate(async ({session,shell}) => {
    const protocol = session.fromPartition('persist:lume-courses').protocol;
    await protocol.unhandle('https');
    protocol.handle('https', request => {
      const path = new URL(request.url).pathname;
      if (path.includes('/learn/lecture/')) return Response.redirect('https://www.udemy.com/join/passwordless-auth/');
      if (path.startsWith('/api-2.0/auth/')) return new Response('',{status:403});
      return new Response('<button onclick="fetch(\`/api-2.0/auth/code-generation/login/4.0/\`)">Continuar</button>',{headers:{'Content-Type':'text/html'}});
    });
    shell.openExternal = async address => { globalThis.testOpenedLesson = address; };
  });
  await page.evaluate(url => window.open(url, '_blank'), loginLesson);
  const login = await desktop.context().waitForEvent('page', {predicate:p => p.url().includes('/join/')}).catch(() =>
    desktop.context().pages().find(p => p.url().includes('/join/')));
  await login.getByRole('button',{name:'Continuar'}).click();
  const bar = desktop.context().pages().find(p => p.url().includes('/renderer/lesson.html'));
  await bar.getByRole('link',{name:/Abrir esta aula no navegador/}).click();
  await page.getByText('Continuar').waitFor();
  assert.equal(await desktop.evaluate(() => globalThis.testOpenedLesson),loginLesson);
  console.log('Gran e Udemy: vídeo de teste reproduzido e fechado na mesma janela.');
} finally { if(desktop) await desktop.close(); host.close(); }
