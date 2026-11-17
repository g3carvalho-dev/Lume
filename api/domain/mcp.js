// Lógica do servidor MCP Remoto do Lume (/api/mcp) e gerenciamento de chave de API.
// Reutiliza as regras de domínio de public/*.js e persiste alterações via
// library-actions.js com revisão otimista. Nunca gera XP nem exclui dados.

import { AppError } from '../errors.js';
import { createSessionToken, hashSessionToken } from './auth.js';
import { readLibrary } from './library-store.js';
import { applyLibraryActions } from './library-actions.js';
import { completedUnitIds } from '../../public/progress-domain.js';
import { materialSteps, stepUnits } from '../../public/material-model.js';
import { nextAction, studyPlan } from '../../public/study-plan.js';
import { minutesByDay, weeklyRhythm } from '../../public/session-domain.js';
import { subjectsOverview } from '../../public/subject-domain.js';
import { MAX_SUBTASKS, MAX_TASKS, focusedTask, isOverdue, localDate } from '../../public/tasks-domain.js';
import { CATEGORIES, REMINDERS, normalizeAppointment, validDate, validZone } from '../../public/agenda-domain.js';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export class McpError extends AppError {
  constructor(message, code = 'mcp_error', status = 400) {
    super(message, code, status);
    this.name = 'McpError';
  }
}

export async function getMcpTokenInfo(db, userId) {
  const row = await db.first(
    'SELECT prefix, created_at, last_used_at FROM mcp_tokens WHERE user_id = ?',
    [userId],
  );
  if (!row) return { active: false, prefix: null, createdAt: null, lastUsedAt: null };
  return {
    active: true,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

export async function createMcpToken(db, userId, now = Date.now()) {
  const { token: raw } = await createSessionToken();
  const token = `lume_mcp_${raw}`;
  const tokenHash = await hashSessionToken(token);
  const prefix = `${token.slice(0, 14)}…`;
  const createdAt = new Date(now).toISOString();

  await db.run(
    `INSERT INTO mcp_tokens (user_id, token_hash, prefix, created_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       prefix = excluded.prefix,
       created_at = excluded.created_at,
       last_used_at = NULL`,
    [userId, tokenHash, prefix, createdAt],
  );
  return { active: true, token, prefix, createdAt, lastUsedAt: null };
}

export async function revokeMcpToken(db, userId) {
  await db.run('DELETE FROM mcp_tokens WHERE user_id = ?', [userId]);
  return { active: false, prefix: null, createdAt: null, lastUsedAt: null };
}

export async function authenticateMcpToken(db, request, now = Date.now()) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match ? match[1].trim() : '';
  if (!token || !token.startsWith('lume_mcp_')) {
    throw new McpError('Chave MCP ausente ou inválida. Envie Authorization: Bearer <chave>.', 'invalid_mcp_token', 401);
  }
  const tokenHash = await hashSessionToken(token);
  const row = await db.first('SELECT user_id FROM mcp_tokens WHERE token_hash = ?', [tokenHash]);
  if (!row) {
    throw new McpError('Chave MCP inválida ou revogada.', 'invalid_mcp_token', 401);
  }
  await db.run('UPDATE mcp_tokens SET last_used_at = ? WHERE user_id = ?', [new Date(now).toISOString(), row.user_id]);
  return { userId: row.user_id };
}

function summarizeMaterial(course, completed, subjectsById) {
  const steps = materialSteps(course);
  const doneCount = steps.filter((step) => completed.has(step.id)).length;
  const totalCount = steps.length;
  const percent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const subject = course.subjectId ? subjectsById.get(course.subjectId) : null;
  return {
    id: course.id,
    title: course.title,
    type: course.type,
    subjectId: course.subjectId || '',
    subjectTitle: subject?.title || '',
    totalUnits: totalCount,
    completedUnits: doneCount,
    progressPercent: percent,
    updatedAt: course.updatedAt || null,
  };
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// O texto do PDF é extraído no navegador de quem estuda (no envio e ao abrir o
// leitor). O MCP só lê o que já foi guardado e diz o que falta quando não há texto.
function contentNote(status, { truncated = false, condensed = false } = {}) {
  if (status === 'pending') return 'O texto deste PDF ainda não foi extraído. Peça para a pessoa abrir o PDF no Lume uma vez: a extração é automática e não usa IA.';
  if (status === 'unavailable') return 'Este PDF não tem texto extraível (provavelmente é uma digitalização). Use o sumário, a página de leitura e as marcações.';
  if (truncated) return 'O documento é maior que o limite guardado: o texto está fiel, mas vai só até o ponto de corte.';
  if (condensed) return 'Texto condensado por IA numa versão antiga do Lume: não é o original palavra por palavra.';
  return '';
}

async function commitMcpActions(db, userId, revision, actions, now) {
  return applyLibraryActions(db, userId, {
    id: `mcp-${crypto.randomUUID()}`,
    revision,
    actions,
  }, { now });
}

export const MCP_TOOLS = [
  {
    name: 'lume_get_overview',
    description: 'Retorna visão geral da conta de estudo: ritmo semanal, minutos estudados nos últimos 7 dias, tarefa em foco, próximos passos do roteiro e totais da biblioteca.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lume_list_materials',
    description: 'Lista materiais de estudo e disciplinas do usuário, com progresso calculado. Pode filtrar por disciplina ou tipo.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', description: 'Filtrar pelo ID da disciplina.' },
        type: { type: 'string', description: 'Filtrar por tipo (course, book, project, track, pdf, etc.).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lume_get_material',
    description: 'Retorna detalhes de um material específico, incluindo suas unidades/etapas e quais já foram concluídas.',
    inputSchema: {
      type: 'object',
      properties: {
        materialId: { type: 'string', description: 'ID do material.' },
      },
      required: ['materialId'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_get_material_content',
    description: 'Retorna o texto extraído (Markdown, com marcadores "## Página N") de um material PDF, além de sumário (outline), página atual de leitura, marcações (highlights) e insights de IA quando existirem. O texto não depende de IA; content.status diz se está pronto (ready), ainda não extraído (pending) ou indisponível por ser digitalização (unavailable), e content.note explica o que fazer. Suporta paginação por caracteres (offset/limit).',
    inputSchema: {
      type: 'object',
      properties: {
        materialId: { type: 'string', description: 'ID do material.' },
        offset: { type: 'number', description: 'Posição inicial em caracteres no Markdown (padrão: 0).' },
        limit: { type: 'number', description: 'Quantidade máxima de caracteres retornada (padrão: 20000, máx: 40000).' },
        includeHighlights: { type: 'boolean', description: 'Se true, inclui marcações do usuário (padrão: true).' },
      },
      required: ['materialId'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_list_tasks',
    description: 'Lista tarefas de estudo do usuário, com filtro opcional por status (open, done, all) e indicação de atraso e foco.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Filtro de status (padrão: open).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lume_list_agenda',
    description: 'Lista compromissos da Agenda em um intervalo de datas (AAAA-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Data inicial (AAAA-MM-DD).' },
        to: { type: 'string', description: 'Data final (AAAA-MM-DD).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lume_get_study_feedback',
    description: 'Consolida consistência recente, distribuição de minutos por dia, tarefas atrasadas e resumo por disciplina para o agente oferecer feedback personalizado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lume_create_task',
    description: 'Cria uma nova tarefa de estudo (com subtarefas opcionais). Não gera XP.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título da tarefa (até 180 caracteres).' },
        dueDate: { type: 'string', description: 'Prazo opcional no formato AAAA-MM-DD.' },
        priority: { type: 'number', enum: [0, 1, 2, 3], description: '0=sem prioridade, 1=alta, 2=média, 3=baixa.' },
        courseId: { type: 'string', description: 'ID de material vinculado (opcional).' },
        subtasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista opcional de títulos de subtarefas (até 10).',
        },
        focus: { type: 'boolean', description: 'Se true, define esta tarefa como foco atual.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_update_task',
    description: 'Atualiza título, prazo, prioridade ou conclusão de uma tarefa avulsa. Não permite concluir tarefas vinculadas a aulas (para preservar regras de XP).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID da tarefa.' },
        title: { type: 'string', description: 'Novo título.' },
        dueDate: { type: 'string', description: 'Novo prazo AAAA-MM-DD (ou string vazia para limpar).' },
        priority: { type: 'number', enum: [0, 1, 2, 3], description: 'Nova prioridade.' },
        done: { type: 'boolean', description: 'Concluir/reabrir tarefa avulsa (bloqueado se vinculada a aula).' },
        focus: { type: 'boolean', description: 'Se true, coloca a tarefa em foco (apenas pendentes).' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_schedule_appointment',
    description: 'Agenda ou atualiza um compromisso na Agenda do usuário.',
    inputSchema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string', description: 'ID existente para editar (opcional; se omitido, cria novo).' },
        title: { type: 'string', description: 'Título do compromisso.' },
        date: { type: 'string', description: 'Data no formato AAAA-MM-DD.' },
        start: { type: 'string', description: 'Horário inicial HH:MM (opcional; requer end).' },
        end: { type: 'string', description: 'Horário final HH:MM (opcional; requer start).' },
        category: { type: 'string', enum: ['study', 'exam', 'delivery', 'personal'], description: 'Categoria (padrão: study).' },
        timeZone: { type: 'string', description: 'Fuso IANA (padrão: America/Sao_Paulo).' },
        reminder: { type: 'number', enum: [-1, 0, 5, 15, 30, 60], description: 'Antecedência do lembrete em minutos (-1 = sem lembrete).' },
        taskIds: { type: 'array', items: { type: 'string' }, description: 'IDs de tarefas vinculadas.' },
      },
      required: ['title', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_create_subject',
    description: 'Cria ou atualiza uma disciplina de estudo.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', description: 'ID da disciplina existente (opcional para criar).' },
        title: { type: 'string', description: 'Nome da disciplina.' },
        color: { type: 'string', description: 'Token de cor (lume, mint, reward, warning, etc.).' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Palavras-chave para organização.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'lume_upsert_material',
    description: 'Cria um material de estudo (curso, livro, projeto, trilha) ou atualiza título, disciplina e lista de etapas/unidades de organização. Não altera progresso nem anexa PDFs.',
    inputSchema: {
      type: 'object',
      properties: {
        materialId: { type: 'string', description: 'ID do material existente (opcional; se omitido, cria novo).' },
        title: { type: 'string', description: 'Título do material.' },
        type: { type: 'string', enum: ['course', 'book', 'project', 'track'], description: 'Tipo do material (padrão: course).' },
        subjectId: { type: 'string', description: 'ID da disciplina vinculada (opcional).' },
        unitTitles: { type: 'array', items: { type: 'string' }, description: 'Lista de títulos de etapas/aulas ao criar um material novo.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
];

async function executeTool(db, userId, name, args = {}, now = Date.now()) {
  const { revision, state } = await readLibrary(db, userId);
  const completed = completedUnitIds(state);
  const subjectsById = new Map((state.subjects || []).map((s) => [s.id, s]));
  const today = localDate(now);

  switch (name) {
    case 'lume_get_overview': {
      const rhythm = weeklyRhythm(state, now);
      const daily = minutesByDay(state, 7, now);
      const focus = focusedTask(state);
      const next = nextAction(state, { now });
      const plan = studyPlan(state, { limit: 5, now });
      const openTasks = (state.tasks || []).filter((t) => !t.done);
      return {
        today,
        materialsCount: state.courses.length,
        subjectsCount: (state.subjects || []).length,
        openTasksCount: openTasks.length,
        overdueTasksCount: openTasks.filter((t) => isOverdue(t, today)).length,
        focusedTask: focus ? { id: focus.id, title: focus.title, dueDate: focus.dueDate } : null,
        weeklyRhythm: rhythm,
        last7DaysMinutes: daily,
        nextAction: next ? { title: next.title || next.stepTitle || '', courseTitle: next.courseTitle || '' } : null,
        suggestedPlan: (plan.steps || []).map((item) => ({
          courseId: item.courseId || '',
          courseTitle: item.courseTitle || '',
          stepTitle: item.title || '',
        })),
        planTotals: plan.totals || null,
      };
    }

    case 'lume_list_materials': {
      const subjectId = typeof args.subjectId === 'string' ? args.subjectId : '';
      const type = typeof args.type === 'string' ? args.type : '';
      const items = state.courses
        .filter((c) => (!subjectId || c.subjectId === subjectId) && (!type || c.type === type))
        .map((c) => summarizeMaterial(c, completed, subjectsById));
      return {
        subjects: (state.subjects || []).map((s) => ({ id: s.id, title: s.title, color: s.color || 'lume' })),
        materials: items,
      };
    }

    case 'lume_get_material': {
      const course = state.courses.find((c) => c.id === args.materialId);
      if (!course) throw new McpError('Material não encontrado.', 'not_found', 404);
      const steps = materialSteps(course).map((step) => ({
        id: step.id,
        title: step.title,
        group: step.moduleTitle || step.sectionTitle || '',
        completed: completed.has(step.id),
      }));
      return {
        ...summarizeMaterial(course, completed, subjectsById),
        units: steps,
      };
    }

    case 'lume_get_material_content': {
      const course = state.courses.find((c) => c.id === args.materialId);
      if (!course) throw new McpError('Material não encontrado.', 'not_found', 404);
      const base = summarizeMaterial(course, completed, subjectsById);
      if (course.type !== 'pdf' || !course.pdf?.fileId) {
        return {
          ...base,
          hasPdf: false,
          units: materialSteps(course).map((s) => ({ id: s.id, title: s.title, completed: completed.has(s.id) })),
        };
      }
      const aiRow = await db.first(
        `SELECT markdown, markdown_status, markdown_source, markdown_chars, insights_json, insights_updated_at
         FROM library_file_ai WHERE user_id = ? AND file_id = ?`,
        [userId, course.pdf.fileId],
      );
      const fullMarkdown = aiRow?.markdown || '';
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const limit = Math.min(40000, Math.max(500, Math.floor(Number(args.limit) || 20000)));
      const markdownChunk = fullMarkdown.slice(offset, offset + limit);
      const nextOffset = offset + markdownChunk.length;
      let insights = null;
      if (aiRow?.insights_json) {
        try { insights = JSON.parse(aiRow.insights_json); } catch { insights = null; }
      }
      const includeHighlights = args.includeHighlights !== false;
      const highlights = includeHighlights
        ? (course.highlights || []).map((h) => ({
          id: h.id,
          page: h.page,
          color: h.color || '',
          ...(h.text ? { text: h.text } : {}),
          ...(h.note ? { note: h.note } : {}),
        }))
        : undefined;
      const status = aiRow?.markdown_status || 'pending';
      const source = aiRow?.markdown_source || null;
      const truncated = String(source || '').endsWith('_truncated');
      const condensed = String(source || '').endsWith('_condensed');
      const note = contentNote(status, { truncated, condensed });
      return {
        ...base,
        hasPdf: true,
        pdf: {
          name: course.pdf.name || '',
          pages: course.pdf.pages || 0,
          outline: course.pdf.outline || [],
        },
        reading: course.reading || null,
        ...(highlights ? { highlights } : {}),
        insights,
        insightsUpdatedAt: aiRow?.insights_updated_at || null,
        content: {
          status,
          source,
          truncated,
          condensed,
          ...(note ? { note } : {}),
          totalChars: aiRow?.markdown_chars ?? fullMarkdown.length,
          offset,
          limit,
          hasMore: nextOffset < fullMarkdown.length,
          nextOffset: nextOffset < fullMarkdown.length ? nextOffset : null,
          markdown: markdownChunk,
        },
      };
    }

    case 'lume_list_tasks': {
      const status = args.status || 'open';
      const focusId = state.focusTaskId || '';
      const tasks = (state.tasks || [])
        .filter((t) => (status === 'all' ? true : status === 'done' ? t.done : !t.done))
        .map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          dueDate: t.dueDate || '',
          overdue: isOverdue(t, today),
          priority: t.priority || 0,
          focused: t.id === focusId,
          courseId: t.courseId || '',
          linkedToLesson: Boolean(t.lessonId),
          subtasks: (t.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: s.done })),
        }));
      return { today, focusTaskId: focusId, tasks };
    }

    case 'lume_list_agenda': {
      const from = validDate(args.from) ? args.from : today;
      const to = validDate(args.to) ? args.to : '';
      const appointments = (state.agenda || [])
        .filter((a) => !a.cancelled && a.date >= from && (!to || a.date <= to))
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
        .map((a) => ({
          id: a.id,
          title: a.title,
          date: a.date,
          endDate: a.endDate || a.date,
          start: a.start || '',
          end: a.end || '',
          category: a.category,
          timeZone: a.timeZone,
          done: a.done,
          taskIds: a.taskIds || [],
        }));
      return { from, to: to || null, appointments };
    }

    case 'lume_get_study_feedback': {
      const rhythm = weeklyRhythm(state, now);
      const daily = minutesByDay(state, 7, now);
      const subjects = subjectsOverview(state);
      const openTasks = (state.tasks || []).filter((t) => !t.done);
      const overdueTasks = openTasks.filter((t) => isOverdue(t, today));
      const materials = state.courses.map((c) => summarizeMaterial(c, completed, subjectsById));
      return {
        today,
        weeklyRhythm: rhythm,
        last7DaysMinutes: daily,
        subjectsSummary: subjects,
        inProgressMaterials: materials.filter((m) => m.progressPercent > 0 && m.progressPercent < 100),
        notStartedMaterials: materials.filter((m) => m.progressPercent === 0).slice(0, 10),
        overdueTasks: overdueTasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority })),
        openTasksCount: openTasks.length,
      };
    }

    case 'lume_create_task': {
      if ((state.tasks || []).length >= MAX_TASKS) throw new McpError(`Limite de ${MAX_TASKS} tarefas atingido.`, 'limit_reached', 400);
      const title = cleanText(args.title, 180);
      if (!title) throw new McpError('Dê um título para a tarefa.', 'invalid_input', 400);
      const dueDate = validDate(args.dueDate) ? args.dueDate : '';
      const priority = [1, 2, 3].includes(Number(args.priority)) ? Number(args.priority) : 0;
      const courseId = typeof args.courseId === 'string' && state.courses.some((c) => c.id === args.courseId) ? args.courseId : '';
      const subtasks = Array.isArray(args.subtasks)
        ? args.subtasks.slice(0, MAX_SUBTASKS).map((s) => cleanText(s, 140)).filter(Boolean).map((s) => ({
          id: crypto.randomUUID(),
          title: s,
          done: false,
        }))
        : [];
      const task = {
        id: crypto.randomUUID(),
        title,
        courseId,
        lessonId: '',
        subtasks,
        dueDate,
        priority,
        done: false,
        createdAt: new Date(now).toISOString(),
        completedAt: null,
      };
      const actions = [{ type: 'task.put', value: task }];
      if (args.focus === true) actions.push({ type: 'account.update', value: { focusTaskId: task.id } });
      const result = await commitMcpActions(db, userId, revision, actions, now);
      return { created: true, revision: result.revision, task };
    }

    case 'lume_update_task': {
      const existing = (state.tasks || []).find((t) => t.id === args.taskId);
      if (!existing) throw new McpError('Tarefa não encontrada.', 'not_found', 404);
      const next = structuredClone(existing);
      if (args.title !== undefined) {
        const title = cleanText(args.title, 180);
        if (!title) throw new McpError('O título da tarefa não pode ficar vazio.', 'invalid_input', 400);
        next.title = title;
      }
      if (args.dueDate !== undefined) {
        if (args.dueDate !== '' && !validDate(args.dueDate)) throw new McpError('Data inválida. Use AAAA-MM-DD.', 'invalid_input', 400);
        next.dueDate = args.dueDate;
      }
      if (args.priority !== undefined) {
        next.priority = [1, 2, 3].includes(Number(args.priority)) ? Number(args.priority) : 0;
      }
      if (args.done !== undefined) {
        // Proteção da política de XP: tarefas vinculadas a aulas não podem ser concluídas via MCP.
        if (existing.lessonId && args.done === true && !existing.done) {
          throw new McpError('Tarefas vinculadas a aulas devem ser concluídas diretamente no Lume.', 'xp_protected', 403);
        }
        next.done = Boolean(args.done);
        next.completedAt = next.done ? new Date(now).toISOString() : null;
      }
      const actions = [{ type: 'task.put', value: next }];
      if (args.focus === true && !next.done) {
        actions.push({ type: 'account.update', value: { focusTaskId: next.id } });
      }
      const result = await commitMcpActions(db, userId, revision, actions, now);
      return { updated: true, revision: result.revision, task: next };
    }

    case 'lume_schedule_appointment': {
      const existing = args.appointmentId ? (state.agenda || []).find((a) => a.id === args.appointmentId) : null;
      if (args.appointmentId && !existing) throw new McpError('Compromisso não encontrado.', 'not_found', 404);
      const timeZone = validZone(args.timeZone) ? args.timeZone : (existing?.timeZone || DEFAULT_TIME_ZONE);
      const category = Object.hasOwn(CATEGORIES, args.category) ? args.category : (existing?.category || 'study');
      const reminder = REMINDERS.includes(args.reminder) ? args.reminder : (existing?.reminder ?? -1);
      const taskIds = Array.isArray(args.taskIds) ? args.taskIds : (existing?.taskIds || []);
      let appointment;
      try {
        appointment = normalizeAppointment({
          id: existing?.id || crypto.randomUUID(),
          title: cleanText(args.title, 180),
          date: args.date,
          endDate: args.date,
          start: args.start ?? existing?.start ?? '',
          end: args.end ?? existing?.end ?? '',
          category,
          timeZone,
          taskIds,
          reminder,
          seriesId: existing?.seriesId || '',
          recurrence: existing?.recurrence || 'none',
          originalDate: existing?.originalDate || args.date,
          done: existing?.done || false,
          cancelled: false,
        });
      } catch (err) {
        throw new McpError(err.message, 'invalid_appointment', 400);
      }
      const result = await commitMcpActions(db, userId, revision, [{ type: 'appointment.put', value: appointment }], now);
      return { saved: true, revision: result.revision, appointment };
    }

    case 'lume_create_subject': {
      const title = cleanText(args.title, 80);
      if (!title) throw new McpError('Dê um nome para a disciplina.', 'invalid_input', 400);
      const existing = args.subjectId ? (state.subjects || []).find((s) => s.id === args.subjectId) : null;
      if (args.subjectId && !existing) throw new McpError('Disciplina não encontrada.', 'not_found', 404);
      const subject = {
        id: existing?.id || crypto.randomUUID(),
        title,
        color: typeof args.color === 'string' && args.color ? args.color.slice(0, 32) : (existing?.color || 'lume'),
        keywords: Array.isArray(args.keywords) ? args.keywords.map((k) => cleanText(k, 40)).filter(Boolean).slice(0, 12) : (existing?.keywords || []),
        createdAt: existing?.createdAt || new Date(now).toISOString(),
      };
      const result = await commitMcpActions(db, userId, revision, [{ type: 'subject.put', value: subject }], now);
      return { saved: true, revision: result.revision, subject };
    }

    case 'lume_upsert_material': {
      const title = cleanText(args.title, 140);
      if (!title) throw new McpError('Dê um título para o material.', 'invalid_input', 400);
      const existing = args.materialId ? state.courses.find((c) => c.id === args.materialId) : null;
      if (args.materialId && !existing) throw new McpError('Material não encontrado.', 'not_found', 404);
      if (existing?.type === 'pdf') throw new McpError('Materiais em PDF não podem ser editados via MCP.', 'unsupported_type', 400);

      const allowedTypes = ['course', 'book', 'project', 'track'];
      const type = allowedTypes.includes(args.type) ? args.type : (existing?.type || 'course');
      const subjectId = typeof args.subjectId === 'string' ? args.subjectId : (existing?.subjectId || '');
      let units = existing?.units;
      if (!existing) {
        const unitTitles = Array.isArray(args.unitTitles) && args.unitTitles.length
          ? args.unitTitles.map((u) => cleanText(u, 140)).filter(Boolean).slice(0, 100)
          : ['Etapa 1'];
        units = stepUnits(unitTitles.map((u) => ({ id: crypto.randomUUID(), title: u })));
      }
      const material = existing
        ? { ...existing, title, subjectId, updatedAt: new Date(now).toISOString() }
        : {
          id: crypto.randomUUID(),
          title,
          type,
          subjectId,
          units,
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        };
      const result = await commitMcpActions(db, userId, revision, [{ type: 'material.put', value: material }], now);
      return { saved: true, revision: result.revision, material: summarizeMaterial(material, completed, subjectsById) };
    }

    default:
      throw new McpError(`Ferramenta desconhecida: ${name}`, 'unknown_tool', 404);
  }
}

export async function handleMcpRpc(db, userId, payload, { now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return {
      status: 400,
      body: { jsonrpc: '2.0', id: payload?.id ?? null, error: { code: -32600, message: 'Requisição JSON-RPC 2.0 inválida.' } },
    };
  }

  const { id = null, method, params = {} } = payload;

  if (method === 'notifications/initialized') {
    return { status: 202, body: null };
  }
  if (method === 'ping') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
  }
  if (method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'lume-mcp', version: '1.0.0' },
        },
      },
    };
  }
  if (method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } } };
  }
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    if (typeof toolName !== 'string' || !toolName) {
      return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32602, message: 'Informe o nome da ferramenta.' } } };
    }
    try {
      const data = await executeTool(db, userId, toolName, toolArgs, now);
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          },
        },
      };
    } catch (error) {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: error?.message || 'Não foi possível executar a ferramenta.' }],
          },
        },
      };
    }
  }

  return {
    status: 200,
    body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Método não suportado: ${method}` } },
  };
}
