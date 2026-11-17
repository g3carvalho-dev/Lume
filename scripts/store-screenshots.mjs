// Gera as capturas da Microsoft Store (1920x1080) com a conta de demonstração.
// Abre o aplicativo de desktop (Electron) com API e perfil isolados.
// Uso: node scripts/store-screenshots.mjs <pasta de saída>
import { _electron as electron, request } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createInitialState, addCourse, completeMission } from '../public/domain.js';
import { addSubject, linkMaterialSubject } from '../public/subject-domain.js';
import { addTask, localDate } from '../public/tasks-domain.js';
import { createAppointment, shiftDate } from '../public/agenda-domain.js';
import { libraryActions } from '../public/library-actions.js';

const [out = 'output/store/screenshots'] = process.argv.slice(2);
const origin = 'http://127.0.0.1:4391';
await mkdir(out, { recursive: true });
const headers = { origin };
const stamp = Date.now();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();

let s = { ...createInitialState(), onboarded: true };
s.profile = { ...s.profile };
s.preferences = { ...s.preferences, weeklyGoal: 4, dailyMinutes: 120 };
const subjects = [['dc', 'Direito Constitucional', 'lume'], ['dp', 'Direito Penal', 'reward'], ['pt', 'Português', 'mint']];
for (const [id, title, color] of subjects) s = addSubject(s, { title, color, keywords: [title.toLowerCase()] }, id);
const courses = [
  ['c1', 'Constitucional Completo', 'dc', ['Princípios fundamentais', 'Direitos e garantias', 'Organização do Estado', 'Poder Legislativo', 'Poder Executivo', 'Controle de constitucionalidade']],
  ['c2', 'Penal – Parte Geral', 'dp', ['Teoria do crime', 'Tipicidade', 'Ilicitude', 'Culpabilidade', 'Concurso de pessoas']],
  ['c3', 'Gramática para concursos', 'pt', ['Classes de palavras', 'Sintaxe', 'Concordância', 'Regência e crase']],
];
for (const [id, title, sub, steps] of courses) s = linkMaterialSubject(addCourse(s, { title, steps }, id), id, sub);
const done = { c1: 4, c2: 2, c3: 1 };
for (const [id, , , steps] of courses) {
  const course = s.courses.find((c) => c.id === id);
  course.units.slice(0, done[id]).forEach((unit, i) => { s = completeMission(s, id, unit.id, { now: day(-(done[id] - i) - 1) }).state; });
}
const today = localDate();
s = addTask(s, { title: 'Resolver 20 questões de controle de constitucionalidade', courseId: 'c1', dueDate: today, priority: 2 });
s = addTask(s, { title: 'Revisar teoria do crime', courseId: 'c2', dueDate: shiftDate(today, 1), priority: 1 });
s = addTask(s, { title: 'Fichamento de concordância', courseId: 'c3', dueDate: shiftDate(today, 3), priority: 0 });
s = addTask(s, { title: 'Simulado semanal', dueDate: shiftDate(today, 5), priority: 1 });
s = { ...s, focusTaskId: s.tasks[0].id };
const appt = (title, category, date, start, end) => { s = createAppointment(s, { title, category, date, start, end, timeZone: 'America/Sao_Paulo', reminder: 15, recurrence: 'none', taskIds: [], tasks: [] }); };
appt('Aula de Constitucional', 'study', shiftDate(today, 0), '19:00', '20:30');
appt('Revisão de Penal', 'study', shiftDate(today, 2), '08:00', '09:30');
appt('Simulado', 'exam', shiftDate(today, 5), '09:00', '12:00');
appt('Entrega do resumo', 'delivery', shiftDate(today, 9), '', '');
appt('Aula de Português', 'study', shiftDate(today, -2), '20:00', '21:00');
s.studySessions = [-6, -5, -4, -3, -2, -1, 0].map((n, i) => {
  const ms = [50, 75, 40, 90, 65, 80, 35][i] * 60000, start = Date.now() + n * 86400000 - 3600000;
  return { id: `sess${i}`, courseId: 'c1', stepId: '', label: 'Constitucional Completo', startedAt: new Date(start).toISOString(), endedAt: new Date(start + ms).toISOString(), durationMs: ms, origin: 'declared' };
});

const temp = await mkdtemp(join(tmpdir(), 'lume-store-'));
const server = spawn(process.execPath, ['server.js'], { cwd: resolve('.'), env: { ...process.env, PORT: '4391', LUME_DATA_DIR: join(temp, 'data'), BCRYPT_ROUNDS: '4', LUME_ATTEMPT_LIMIT: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('servidor')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('disponível')) { clearTimeout(t); ok(); } }); });
const env = { ...process.env, APPDATA: join(temp, 'appdata'), XDG_CONFIG_HOME: join(temp, 'appdata'), LUME_API_URL: origin };
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(new URL('../companion/package.json', import.meta.url));
const desktop = await electron.launch({ executablePath: require('electron'), args: [resolve('companion'), `--user-data-dir=${join(temp, 'profile')}`], env, timeout: 30000 });
try {
  const page = await desktop.firstWindow();
  await page.waitForURL(`${origin}/**`);
  const me = await page.request.post(`${origin}/api/register`, { headers, data: { name: 'Marina Souza', email: `marina-${stamp}@example.test`, password: 'senha-demo-12345' } });
  if (me.status() !== 201) throw new Error('registro ' + me.status());
  const cur = await (await page.request.get(`${origin}/api/library`, { headers })).json();
  const res = await page.request.post(`${origin}/api/library/actions`, { headers, data: { id: crypto.randomUUID(), revision: cur.revision, actions: libraryActions(cur.state, s) } });
  if (!res.ok()) throw new Error('seed ' + res.status() + await res.text());
  for (const n of ['Rafael Lima', 'Beatriz Alves', 'Caio Mendes']) {
    const code = (await (await page.request.post(`${origin}/api/friends/invite`, { headers, data: {} })).json()).code;
    const g = await request.newContext({ baseURL: origin });
    await g.post('/api/register', { headers, data: { name: n, email: `${n.split(' ')[0].toLowerCase()}-${stamp}@example.test`, password: 'senha-demo-12345' } });
    await g.post('/api/friends/accept', { headers, data: { code } });
    await g.dispose();
  }
  const cookie = me.headers()['set-cookie'].match(/lume_session=([^;]+)/)[1];
  await desktop.evaluate(async ({ session }, { origin, cookie }) => session.defaultSession.cookies.set({ url: origin, name: 'lume_session', value: cookie, httpOnly: true, sameSite: 'lax' }), { origin, cookie });
  await desktop.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1920, 1080); w.center(); w.show(); });
  const shots = [
    ['01-inicio', '#hoje'], ['02-biblioteca', '#biblioteca'], ['03-plano-tarefas', '#tarefas'], ['04-calendario', '#agenda'],
    ['05-amigos', '#adicionar'], ['06-ranking', '#ranking'], ['07-perfil', '#perfil'], ['08-configuracoes', '#configuracoes'],
  ];
  await page.goto(`${origin}/#hoje`); await page.reload();
  // A tela do monitor pode ser menor que 1080 px (barra de tarefas): fixa a área do app em 1920x1080.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const [name, hash] of shots) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, await page.evaluate(() => `${innerWidth}x${innerHeight} ${document.title}`));
  }
} finally { await desktop.close(); server.kill(); }
