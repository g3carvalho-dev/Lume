import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sqliteAdapter, applyMigrations } from '../../api/adapters/sqlite.js';
import { createApp } from '../../api/app.js';
import { createSessionToken, hashSessionToken } from '../../api/domain/auth.js';
import {
  authenticateMcpToken, createMcpToken, getMcpTokenInfo, handleMcpRpc, revokeMcpToken,
} from '../../api/domain/mcp.js';
import { readLibrary } from '../../api/domain/library-store.js';
import { applyLibraryActions } from '../../api/domain/library-actions.js';
import { ensureXpSettings, getXpSnapshot } from '../../api/domain/xp.js';
import { stepUnits } from '../../public/material-model.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  applyMigrations(sqlite, fileURLToPath(new URL('../../migrations/', import.meta.url)));
  const db = sqliteAdapter(sqlite);
  sqlite.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)')
    .run('u1', 'Ana Luz', 'ana@example.test', 'x', '2026-01-01T00:00:00Z');
  return { db, sqlite };
}

test('ciclo de vida da chave MCP única: gera, autentica, atualiza uso e revoga', async (t) => {
  const { db } = fixture(t);

  const initial = await getMcpTokenInfo(db, 'u1');
  assert.equal(initial.active, false);

  const created = await createMcpToken(db, 'u1', Date.parse('2026-11-15T10:00:00Z'));
  assert.equal(created.active, true);
  assert.match(created.token, /^lume_mcp_/);
  assert.ok(created.prefix.startsWith('lume_mcp_'));

  const info = await getMcpTokenInfo(db, 'u1');
  assert.equal(info.active, true);
  assert.equal(info.prefix, created.prefix);
  assert.equal(info.lastUsedAt, null);

  const req = new Request('http://localhost/api/mcp', {
    headers: { authorization: `Bearer ${created.token}` },
  });
  const auth = await authenticateMcpToken(db, req, Date.parse('2026-11-15T10:05:00Z'));
  assert.equal(auth.userId, 'u1');

  const afterUse = await getMcpTokenInfo(db, 'u1');
  assert.equal(afterUse.lastUsedAt, '2026-11-15T10:05:00.000Z');

  await revokeMcpToken(db, 'u1');
  await assert.rejects(
    () => authenticateMcpToken(db, req),
    (err) => err.code === 'invalid_mcp_token' && err.status === 401,
  );
});

test('protocolo MCP JSON-RPC 2.0: initialize, tools/list, planejamento e bloqueio de XP', async (t) => {
  const { db } = fixture(t);
  const now = Date.parse('2026-11-15T12:00:00Z');
  await ensureXpSettings(db, 'u1', { now: now - 1000 });

  const init = await handleMcpRpc(db, 'u1', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { now });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'lume-mcp');

  const ack = await handleMcpRpc(db, 'u1', { jsonrpc: '2.0', method: 'notifications/initialized' }, { now });
  assert.equal(ack.status, 202);
  assert.equal(ack.body, null);

  const listed = await handleMcpRpc(db, 'u1', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { now });
  const toolNames = listed.body.result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes('lume_create_task'));
  assert.ok(toolNames.includes('lume_schedule_appointment'));
  assert.ok(toolNames.includes('lume_get_study_feedback'));

  // Criar disciplina e material via MCP
  const subRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'lume_create_subject', arguments: { title: 'Algoritmos', color: 'lume' } },
  }, { now });
  const subData = JSON.parse(subRes.body.result.content[0].text);
  assert.equal(subData.saved, true);

  const matRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'lume_upsert_material',
      arguments: {
        title: 'Estruturas de Dados',
        type: 'course',
        subjectId: subData.subject.id,
        unitTitles: ['Árvores Binárias', 'Grafos'],
      },
    },
  }, { now });
  const matData = JSON.parse(matRes.body.result.content[0].text);
  assert.equal(matData.material.totalUnits, 2);

  // Criar tarefa avulsa e agendar compromisso
  const taskRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'lume_create_task',
      arguments: { title: 'Revisar árvores AVL', dueDate: '2026-11-16', priority: 1, focus: true },
    },
  }, { now });
  const taskData = JSON.parse(taskRes.body.result.content[0].text);
  assert.equal(taskData.created, true);

  const apptRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'lume_schedule_appointment',
      arguments: {
        title: 'Sessão de Algoritmos',
        date: '2026-11-16',
        start: '19:00',
        end: '20:30',
        category: 'study',
        taskIds: [taskData.task.id],
      },
    },
  }, { now });
  const apptData = JSON.parse(apptRes.body.result.content[0].text);
  assert.equal(apptData.saved, true);

  // Overview e feedback devem refletir os dados criados, com 0 XP gerado
  const feedbackRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'lume_get_study_feedback', arguments: {} },
  }, { now });
  const feedback = JSON.parse(feedbackRes.body.result.content[0].text);
  assert.equal(feedback.openTasksCount, 1);

  const snapshot = await getXpSnapshot(db, 'u1');
  assert.equal(snapshot.summary.totalXP, 0);

  // Tarefa vinculada a aula não pode ser concluída via MCP
  const lib = await readLibrary(db, 'u1');
  const course = lib.state.courses[0];
  const lessonId = course.units[0].id;
  await applyLibraryActions(db, 'u1', {
    id: 'setup-linked-task',
    revision: lib.revision,
    actions: [{
      type: 'task.put',
      value: {
        id: 't-linked',
        title: 'Assistir aula 1',
        courseId: course.id,
        lessonId,
        subtasks: [],
        dueDate: '',
        priority: 0,
        done: false,
        createdAt: new Date(now).toISOString(),
        completedAt: null,
      },
    }],
  }, { now });

  const blockedRes = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'lume_update_task', arguments: { taskId: 't-linked', done: true } },
  }, { now });
  assert.equal(blockedRes.body.result.isError, true);
  assert.match(blockedRes.body.result.content[0].text, /diretamente no Lume/);
});

test('rotas HTTP /api/mcp/token e /api/mcp integradas ao createApp', async (t) => {
  const { db } = fixture(t);
  const { token: sessionToken } = await createSessionToken();
  const sessionHash = await hashSessionToken(sessionToken);
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [sessionHash, 'u1', '2026-11-15T00:00:00Z', '2026-12-15T00:00:00Z'],
  );

  const app = createApp({ db, env: { ATTEMPT_LIMIT: '200' }, log: () => {} });
  const cookieHeader = { cookie: `lume_session=${sessionToken}`, origin: 'http://localhost' };

  const createRes = await app.fetch(new Request('http://localhost/api/mcp/token', {
    method: 'POST',
    headers: { ...cookieHeader, 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(createRes.status, 201);
  const { token } = await createRes.json();
  assert.match(token, /^lume_mcp_/);

  const mcpRes = await app.fetch(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lume_get_overview', arguments: {} } }),
  }));
  assert.equal(mcpRes.status, 200);
  const rpcJson = await mcpRes.json();
  assert.equal(rpcJson.result.isError, undefined);

  const delRes = await app.fetch(new Request('http://localhost/api/mcp/token', {
    method: 'DELETE',
    headers: cookieHeader,
  }));
  assert.equal(delRes.status, 200);

  const deniedRes = await app.fetch(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  }));
  assert.equal(deniedRes.status, 401);
});

test('lume_get_material_content retorna markdown paginado, insights, outline, reading e highlights de PDF', async (t) => {
  const { db } = fixture(t);
  const now = Date.parse('2026-11-15T12:00:00Z');
  await ensureXpSettings(db, 'u1', { now: now - 1000 });
  const fileId = 'file-pdf-1';

  await db.run(
    `INSERT INTO library_files (user_id, id, size, name, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['u1', fileId, 1024, 'redes.pdf', new Date(now).toISOString(), 'ready'],
  );
  await db.run(
    `INSERT INTO library_file_ai (user_id, file_id, markdown, markdown_status, markdown_source, markdown_chars, insights_json, insights_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'u1',
      fileId,
      `## Página 1\n${'A'.repeat(600)}\n## Página 2\n${'B'.repeat(600)}`,
      'ready',
      'pdfjs',
      1230,
      JSON.stringify({ summary: 'Resumo de redes TCP/IP', topics: ['Camada de Transporte'] }),
      new Date(now).toISOString(),
    ],
  );

  const lib = await readLibrary(db, 'u1');
  await applyLibraryActions(db, 'u1', {
    id: 'add-pdf-mat',
    revision: lib.revision,
    actions: [{
      type: 'material.put',
      value: {
        id: 'mat-pdf-1',
        title: 'Redes de Computadores',
        type: 'pdf',
        subjectId: '',
        units: stepUnits([{ id: 'u-pdf-1', title: 'Leitura completa' }]),
        pdf: {
          fileId,
          name: 'redes.pdf',
          size: 1024,
          pages: 12,
          outline: [{ title: 'Capítulo 1 — TCP', page: 1, depth: 0 }],
        },
        reading: { page: 4, maxPage: 6, section: 'Capítulo 1 — TCP', updatedAt: new Date(now).toISOString() },
        highlights: [{ id: 'h1', page: 2, color: 'azul', text: 'Handshake em 3 vias', rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }] }],
      },
    }],
  }, { now });

  const page1 = await handleMcpRpc(db, 'u1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'lume_get_material_content', arguments: { materialId: 'mat-pdf-1', offset: 0, limit: 500 } },
  }, { now });
  const data1 = JSON.parse(page1.body.result.content[0].text);
  assert.equal(data1.hasPdf, true);
  assert.equal(data1.pdf.pages, 12);
  assert.equal(data1.pdf.outline[0].title, 'Capítulo 1 — TCP');
  assert.equal(data1.reading.page, 4);
  assert.equal(data1.highlights.length, 1);
  assert.equal(data1.highlights[0].rects, undefined);
  assert.equal(data1.insights.summary, 'Resumo de redes TCP/IP');
  assert.equal(data1.content.hasMore, true);
  assert.equal(data1.content.nextOffset, 500);
});
