import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMessage, applyReaction, applyRead, isThreadKey, listWithMessage, mergeThread, messagePreview, optimisticId, prependPage,
  threadKey, unreadFromList,
} from '../../src/lib/message-cache.js';
import { messageAlertFromEvent } from '../../public/social-domain.js';

// O cache de mensagens muda pelos avisos do canal, sem ir ao servidor.

const id = (n, suffix = `m${n}`) => `${String(1700000000000 + n).padStart(13, '0')}-${suffix}`;
const msg = (n, extra = {}) => ({ id: id(n), body: `m${n}`, fromMe: false, at: '2026-11-17T12:00:00.000Z', reactions: [], ...extra });

test('endereços: conversa direta e grupo, nunca contador ou ajustes', () => {
  assert.equal(threadKey({ kind: 'direct', id: 'u2' }), '/api/messages/u2');
  assert.equal(threadKey({ kind: 'group', id: 'g1' }), '/api/groups/g1');
  assert.equal(threadKey(null), '');
  assert.equal(isThreadKey('/api/messages/u2'), true);
  assert.equal(isThreadKey('/api/groups/g1'), true);
  for (const key of ['/api/messages', '/api/messages/unread', '/api/messages/settings', '/api/messages/u2/read', '/api/friends']) {
    assert.equal(isThreadKey(key), false, key);
  }
});

test('mensagem que chega entra uma vez e em ordem, antes dos envios em andamento', () => {
  const pending = { id: optimisticId('abc'), body: 'enviando', fromMe: true };
  const thread = { messages: [msg(1), msg(3), pending] };
  const next = appendMessage(thread, msg(2));
  assert.deepEqual(next.messages.map((item) => item.body), ['m1', 'm2', 'm3', 'enviando']);
  assert.equal(appendMessage(next, msg(2)), next, 'repetida não duplica');
  assert.equal(appendMessage(undefined, msg(2)), undefined, 'conversa fora do cache não é criada pela metade');
});

test('releitura preserva páginas anteriores, o que chegou durante a busca e envios pendentes', () => {
  const previous = { hasMore: true, messages: [msg(1), msg(2), msg(3), msg(6), { id: optimisticId('abc'), body: 'enviando' }, { id: optimisticId('def'), body: 'outro' }] };
  const incoming = { hasMore: true, muted: true, messages: [msg(3), msg(4), { ...msg(5), id: id(5, 'abc') }] };
  const merged = mergeThread(previous, incoming);
  assert.deepEqual(merged.messages.map((item) => item.body), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'outro']);
  assert.equal(merged.hasMore, true, 'vale o que as páginas anteriores diziam');
  assert.equal(merged.muted, true, 'o resto vem da resposta nova');

  const far = mergeThread({ hasMore: false, messages: [msg(1), msg(2)] }, { hasMore: true, messages: [msg(8), msg(9)] });
  assert.deepEqual(far.messages.map((item) => item.body), ['m8', 'm9'], 'com buraco entre as páginas, fica só a nova');
  const near = mergeThread({ hasMore: false, messages: [msg(1), msg(2)] }, { hasMore: false, messages: [msg(1), msg(2), msg(3)] });
  assert.equal(near.messages.length, 3);
  assert.equal(mergeThread(undefined, incoming), incoming);
});

test('página anterior entra na frente e diz se ainda há mais', () => {
  const thread = { hasMore: true, messages: [msg(3), msg(4)] };
  const next = prependPage(thread, { hasMore: false, messages: [msg(1), msg(2), msg(3)] });
  assert.deepEqual(next.messages.map((item) => item.body), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(next.hasMore, false);
});

test('reação e leitura de outra pessoa mudam só o que ela mudou', () => {
  const thread = { messages: [msg(1, { reactions: [{ emoji: '👍', count: 1, mine: true }] }), msg(2, { fromMe: true }), msg(3, { fromMe: true })] };
  const more = applyReaction(thread, { messageId: id(1), emoji: '👍', on: true });
  assert.deepEqual(more.messages[0].reactions, [{ emoji: '👍', count: 2, mine: true }]);
  const other = applyReaction(more, { messageId: id(1), emoji: '🙌', on: true });
  assert.deepEqual(other.messages[0].reactions[1], { emoji: '🙌', count: 1, mine: false });
  const less = applyReaction(applyReaction(other, { messageId: id(1), emoji: '🙌', on: false }), { messageId: id(1), emoji: '👍', on: false });
  assert.deepEqual(less.messages[0].reactions, [{ emoji: '👍', count: 1, mine: true }]);

  const read = applyRead(thread, `${String(1700000000002).padStart(13, '0')}~`, '2026-11-17T12:01:00.000Z');
  assert.equal(read.messages[1].readAt, '2026-11-17T12:01:00.000Z');
  assert.equal(read.messages[2].readAt, undefined, 'a enviada depois da leitura continua sem a marca');
  assert.equal(read.messages[0].readAt, undefined, 'mensagem recebida não ganha marca');
});

test('lista: última mensagem, não lidas e total do menu', () => {
  const list = {
    conversations: [{ id: 'u2', name: 'Bia', unread: 0, lastMessage: null }, { id: 'u3', name: 'Carla', unread: 4, muted: true }, { id: 'u4', name: 'Duda', unread: 2, blockedByMe: true }],
    groups: [{ id: 'g1', name: 'Turma', unread: 1, lastMessage: null }],
  };
  const direct = listWithMessage(list, { conversation: { kind: 'direct', id: 'u2' }, message: msg(1, { body: 'Oi' }) });
  assert.equal(direct.found, true);
  assert.deepEqual(direct.list.conversations[0].lastMessage, { id: id(1), fromMe: false, preview: 'Oi', at: '2026-11-17T12:00:00.000Z' });
  assert.equal(direct.list.conversations[0].unread, 1);
  assert.equal(listWithMessage(direct.list, { conversation: { kind: 'direct', id: 'u2' }, message: msg(1) }).list.conversations[0].unread, 1, 'o mesmo aviso duas vezes não soma');

  const group = listWithMessage(list, { conversation: { kind: 'group', id: 'g1' }, message: msg(2, { body: '', gif: 'x', sender: { name: 'Carla Souza' } }) });
  assert.equal(group.list.groups[0].lastMessage.preview, 'Carla: GIF');
  assert.equal(group.list.groups[0].unread, 2);
  assert.equal(listWithMessage(list, { conversation: { kind: 'group', id: 'novo' }, message: msg(3) }).found, false);
  assert.equal(messagePreview({ kind: 'system', body: 'Ana criou o grupo.' }, 'group'), 'Ana criou o grupo.');

  assert.equal(unreadFromList(list), 1, 'silenciada e bloqueada não contam');
  assert.equal(unreadFromList(undefined), null);
});

test('aviso flutuante pelo canal: só mensagem direta, uma vez, nunca silenciada nem da conversa aberta', () => {
  const event = { type: 'message', conversation: { kind: 'direct', id: 'u2' }, sender: { id: 'u2', name: 'Bia', avatar: '/a.webp' }, message: msg(1, { body: 'Oi!\n  Vamos   estudar?' }) };
  assert.deepEqual(messageAlertFromEvent(event), { messageId: id(1), from: { id: 'u2', name: 'Bia', avatar: '/a.webp' }, preview: 'Oi! Vamos estudar?' });
  assert.equal(messageAlertFromEvent(event, { seen: new Set([id(1)]) }), null);
  assert.equal(messageAlertFromEvent(event, { openContactId: 'u2' }), null);
  assert.equal(messageAlertFromEvent(event, { notifications: false }), null);
  assert.equal(messageAlertFromEvent({ ...event, muted: true }), null);
  assert.equal(messageAlertFromEvent({ ...event, conversation: { kind: 'group', id: 'g1' } }), null);
  assert.equal(messageAlertFromEvent({ type: 'reaction', conversation: event.conversation }), null);
  assert.equal(messageAlertFromEvent({ ...event, message: msg(2, { body: '', gif: 'x' }) }).preview, 'GIF');
});
