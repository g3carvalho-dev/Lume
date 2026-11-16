// Amigos, perfil entre amigos, mensagens diretas, bloqueio e colaboração.

import {
  blockContact, getThread, listBlocks, listConversations, markThreadRead, messagePreferences, muteDirect, reactToDirectMessage,
  sendMessage, unblockContact, unreadSummary, updateMessagePreferences, MESSAGE_WINDOW_LIMIT,
} from '../domain/messages.js';
import {
  addGroupMembers, createGroup, deleteGroup, getGroupThread, listGroups, markGroupRead, muteGroup, reactToGroupMessage, removeGroupMember,
  renameGroup, sendGroupMessage, unreadGroupMessages,
} from '../domain/groups.js';
import { createReport, listReports, reviewReport } from '../domain/reports.js';
import { acceptInvite, createInvite, listFriends, listProfileFriends, readFriendProfile, readPersonCard, removeFriend, touchUserPresence } from '../domain/friends.js';
import { cancelRequest, getHandle, listRequests, userIdByHandle, respondRequest, searchByHandle, sendRequest, setHandle } from '../domain/friend-requests.js';
import {
  cancelCollaborationInvite, createCollaborationInvite, listCollaborationInvites, respondCollaborationInvite,
} from '../domain/collaboration.js';
import { listNotifications, markNotificationsSeen } from '../domain/notifications.js';
import { LIMITS, isCreator } from '../config.js';
import { announce } from '../realtime.js';
import { json } from '../http.js';
import { AppError } from '../errors.js';

const FRIENDS = { auth: 'Entre na sua conta para convidar amigos.', origin: true };
const MESSAGES = { auth: 'Entre na sua conta para conversar com amigos.', origin: true };
const NOTIFICATIONS = { auth: 'Entre na sua conta para ver suas notificações.', origin: true };
const COLLABORATION = { auth: 'Entre na sua conta para convidar alguém para colaborar.', origin: true };

export function socialRoutes(router) {
  router
    .add('GET', '/api/notifications', NOTIFICATIONS, async ({ db, user, config }) => json(await listNotifications(db, user.id, Date.now(), { creator: isCreator(user, config) })))
    .add('POST', '/api/notifications/seen', NOTIFICATIONS, async ({ db, user }) => json(await markNotificationsSeen(db, user.id)));
  router
    .add('GET', '/api/friends', FRIENDS, async ({ db, user }) => {
      await touchUserPresence(db, user.id);
      return json(await listFriends(db, user.id));
    })
    .add('POST', '/api/friends/invite', FRIENDS, async ({ db, user }) => json(await createInvite(db, user.id), 201))
    .add('POST', '/api/friends/accept', {
      ...FRIENDS,
      rateLimit: { key: (ctx) => `friends-accept|${ctx.user.id}`, limit: 20, message: 'Muitas tentativas de convite. Aguarde alguns minutos.', code: 'rate_limited' },
    }, async (ctx) => {
      const body = await ctx.json(LIMITS.tiny);
      return json(await acceptInvite(ctx.db, ctx.user.id, body.code));
    })
    .add('GET', '/api/friends/requests', FRIENDS, async ({ db, user }) => json(await listRequests(db, user.id)))
    .add('GET', '/api/friends/search', {
      ...FRIENDS,
      rateLimit: { key: (ctx) => `friends-search|${ctx.user.id}`, limit: 30, message: 'Muitas buscas em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => json(await searchByHandle(ctx.db, ctx.user.id, ctx.url.searchParams.get('handle'))))
    .add('GET', '/api/friends/handle', FRIENDS, async ({ db, user }) => json({ handle: await getHandle(db, user.id) }))
    .add('PUT', '/api/friends/handle', FRIENDS, async (ctx) =>
      json(await setHandle(ctx.db, ctx.user.id, (await ctx.json(LIMITS.tiny)).handle)))
    .add('POST', '/api/friends/requests', {
      ...FRIENDS,
      rateLimit: { key: (ctx) => `friends-request|${ctx.user.id}`, limit: 30, message: 'Muitas solicitações em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => {
      const sent = await sendRequest(ctx.db, ctx.user.id, await ctx.json(LIMITS.tiny));
      if (sent.toId) await announce(ctx.realtime, sent.toId, { type: 'friend_request', from: ctx.user.id }, ctx.log);
      return json(sent, sent.status === 'sent' ? 201 : 200);
    })
    .add('POST', '/api/friends/requests/:requestId/respond', FRIENDS, async (ctx) =>
      json(await respondRequest(ctx.db, ctx.user.id, ctx.params.requestId, await ctx.json(LIMITS.tiny))))
    .add('DELETE', '/api/friends/requests/:requestId', FRIENDS, async ({ db, user, params }) =>
      json(await cancelRequest(db, user.id, params.requestId)))
    .add('DELETE', '/api/friends/:friendId', FRIENDS, async ({ db, user, params }) =>
      json(await removeFriend(db, user.id, params.friendId)));

  // Cartão rápido da pessoa. Quem não pode abrir o perfil recebe 404, sem confirmar que a conta existe.
  router.add('GET', '/api/people/:personId', { auth: 'Entre na sua conta para ver perfis.', origin: true }, async ({ db, user, params }) => {
    const targetId = params.personId.startsWith('@') ? await userIdByHandle(db, params.personId) : params.personId;
    try {
      if (!targetId) throw new AppError('Pessoa não encontrada.', 'not_found', 404);
      return json(await readPersonCard(db, user.id, targetId));
    } catch (error) {
      if (error?.code === 'not_friends' || error?.code === 'not_found') throw new AppError('Pessoa não encontrada.', 'not_found', 404);
      throw error;
    }
  });

  router.add('GET', '/api/profile/:friendId/friends', { auth: 'Entre na sua conta para ver perfis.', origin: true }, async ({ db, user, params }) => {
    let targetId = params.friendId;
    if (targetId.startsWith('@')) {
      targetId = await userIdByHandle(db, targetId);
      if (!targetId) throw new AppError('Nenhuma pessoa com esse @usuário.', 'not_found', 404);
    }
    try {
      return json(await listProfileFriends(db, user.id, targetId));
    } catch (error) {
      if (error?.code === 'not_friends' && params.friendId.startsWith('@')) throw new AppError('Nenhuma pessoa com esse @usuário.', 'not_found', 404);
      throw error;
    }
  });

  router.add('GET', '/api/profile/:friendId', { auth: 'Entre na sua conta para ver perfis.', origin: true }, async ({ db, user, params }) => {
    // /@usuario: o perfil é pedido pelo @usuário. Perfil que o visitante não pode abrir
    // responde como inexistente, igual à busca, sem confirmar que o @usuário existe.
    if (params.friendId.startsWith('@')) {
      const targetId = await userIdByHandle(db, params.friendId);
      if (!targetId) throw new AppError('Nenhuma pessoa com esse @usuário.', 'not_found', 404);
      if (targetId === user.id) return json({ self: true, id: user.id });
      try {
        return json({ profile: await readFriendProfile(db, user.id, targetId) });
      } catch (error) {
        if (error?.code === 'not_friends') throw new AppError('Nenhuma pessoa com esse @usuário.', 'not_found', 404);
        throw error;
      }
    }
    return json({ profile: await readFriendProfile(db, user.id, params.friendId) });
  });

  router
    .add('GET', '/api/messages', MESSAGES, async ({ db, user }) => json({ ...await listConversations(db, user.id), groups: await listGroups(db, user.id) }))
    .add('GET', '/api/messages/unread', MESSAGES, async ({ db, user }) => {
      await touchUserPresence(db, user.id);
      const summary = await unreadSummary(db, user.id);
      return json({ ...summary, unread: summary.unread + await unreadGroupMessages(db, user.id) });
    })
    .add('GET', '/api/messages/settings', MESSAGES, async ({ db, user }) => json(await messagePreferences(db, user.id)))
    .add(['PATCH', 'POST'], '/api/messages/settings', MESSAGES, async (ctx) =>
      json(await updateMessagePreferences(ctx.db, ctx.user.id, await ctx.json(LIMITS.tiny))))
    .add('POST', '/api/messages/:friendId/read', MESSAGES, async ({ db, user, params }) =>
      json(await markThreadRead(db, user.id, params.friendId)))
    .add('PUT', '/api/messages/:friendId/mute', MESSAGES, async (ctx) =>
      json(await muteDirect(ctx.db, ctx.user.id, ctx.params.friendId, (await ctx.json(LIMITS.tiny)).muted)))
    .add(['PUT', 'DELETE'], '/api/messages/:friendId/messages/:messageId/reaction', {
      ...MESSAGES,
      rateLimit: { key: (ctx) => `message-reactions|${ctx.user.id}`, limit: MESSAGE_WINDOW_LIMIT, message: 'Muitas reações em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => {
      const on = ctx.request.method === 'PUT';
      const reacted = await reactToDirectMessage(ctx.db, ctx.user.id, ctx.params.friendId, ctx.params.messageId, ctx.url.searchParams.get('emoji') || undefined, on);
      if (on) await announce(ctx.realtime, ctx.params.friendId, { type: 'message', from: ctx.user.id }, ctx.log);
      return json(reacted);
    })
    .add('GET', '/api/messages/:friendId', MESSAGES, async ({ db, user, params }) =>
      json(await getThread(db, user.id, params.friendId)))
    .add('POST', '/api/messages/:friendId', {
      ...MESSAGES,
      rateLimit: { key: (ctx) => `messages|${ctx.user.id}`, limit: MESSAGE_WINDOW_LIMIT, message: 'Muitas mensagens em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => {
      const sent = await sendMessage(ctx.db, ctx.user.id, ctx.params.friendId, await ctx.json(LIMITS.small));
      await announce(ctx.realtime, ctx.params.friendId, { type: 'message', from: ctx.user.id }, ctx.log);
      return json(sent, 201);
    })
    .add('GET', '/api/blocks', MESSAGES, async ({ db, user }) => json(await listBlocks(db, user.id)))
    .add('POST', '/api/blocks/:targetId', MESSAGES, async ({ db, user, params }) => json(await blockContact(db, user.id, params.targetId)))
    .add('DELETE', '/api/blocks/:targetId', MESSAGES, async ({ db, user, params }) => json(await unblockContact(db, user.id, params.targetId)));

  // Grupos de conversa entre amigos.
  const GROUPS = { auth: 'Entre na sua conta para conversar em grupo.', origin: true };
  const tellMembers = (ctx, ids) => Promise.all(ids.filter((id) => id !== ctx.user.id).map((id) => announce(ctx.realtime, id, { type: 'message', from: ctx.user.id }, ctx.log)));
  router
    .add('POST', '/api/groups', {
      ...GROUPS,
      rateLimit: { key: (ctx) => `groups|${ctx.user.id}`, limit: 20, message: 'Muitos grupos criados em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => {
      const created = await createGroup(ctx.db, ctx.user.id, await ctx.json(LIMITS.small));
      await tellMembers(ctx, created.memberIds);
      return json({ id: created.id }, 201);
    })
    .add('GET', '/api/groups/:groupId', GROUPS, async ({ db, user, params }) => json(await getGroupThread(db, user.id, params.groupId)))
    .add('POST', '/api/groups/:groupId/read', GROUPS, async ({ db, user, params }) => json(await markGroupRead(db, user.id, params.groupId)))
    .add('PUT', '/api/groups/:groupId/mute', GROUPS, async (ctx) =>
      json(await muteGroup(ctx.db, ctx.user.id, ctx.params.groupId, (await ctx.json(LIMITS.tiny)).muted)))
    .add(['PUT', 'DELETE'], '/api/groups/:groupId/messages/:messageId/reaction', {
      ...GROUPS,
      rateLimit: { key: (ctx) => `message-reactions|${ctx.user.id}`, limit: MESSAGE_WINDOW_LIMIT, message: 'Muitas reações em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => json(await reactToGroupMessage(ctx.db, ctx.user.id, ctx.params.groupId, ctx.params.messageId, ctx.url.searchParams.get('emoji') || undefined, ctx.request.method === 'PUT')))
    .add('POST', '/api/groups/:groupId/messages', {
      ...GROUPS,
      rateLimit: { key: (ctx) => `messages|${ctx.user.id}`, limit: MESSAGE_WINDOW_LIMIT, message: 'Muitas mensagens em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => {
      const sent = await sendGroupMessage(ctx.db, ctx.user.id, ctx.params.groupId, await ctx.json(LIMITS.small));
      await tellMembers(ctx, sent.memberIds);
      return json({ message: sent.message }, 201);
    })
    .add('PATCH', '/api/groups/:groupId', GROUPS, async (ctx) => {
      const renamed = await renameGroup(ctx.db, ctx.user.id, ctx.params.groupId, (await ctx.json(LIMITS.tiny)).name);
      await tellMembers(ctx, renamed.memberIds);
      return json({ id: renamed.id, name: renamed.name });
    })
    .add('POST', '/api/groups/:groupId/members', GROUPS, async (ctx) => {
      const added = await addGroupMembers(ctx.db, ctx.user.id, ctx.params.groupId, await ctx.json(LIMITS.small));
      await tellMembers(ctx, added.memberIds);
      return json({ id: added.id, added: added.added });
    })
    .add('DELETE', '/api/groups/:groupId/members/:memberId', GROUPS, async (ctx) => {
      const left = await removeGroupMember(ctx.db, ctx.user.id, ctx.params.groupId, ctx.params.memberId);
      await tellMembers(ctx, left.memberIds);
      return json({ id: left.id, deleted: left.deleted });
    })
    .add('DELETE', '/api/groups/:groupId', GROUPS, async (ctx) => {
      const gone = await deleteGroup(ctx.db, ctx.user.id, ctx.params.groupId);
      await tellMembers(ctx, gone.memberIds);
      return json({ deleted: true });
    });

  // Denúncias: qualquer pessoa com conta envia; só a conta criadora lê e analisa.
  const creatorOnly = (ctx) => {
    if (!isCreator(ctx.user, ctx.config)) throw new AppError('Acesso restrito à criadora do Lume.', 'forbidden', 403);
  };
  router
    .add('POST', '/api/reports', {
      auth: 'Entre na sua conta para denunciar.', origin: true,
      rateLimit: { key: (ctx) => `reports|${ctx.user.id}`, limit: 10, message: 'Muitas denúncias em pouco tempo. Aguarde alguns minutos.', code: 'rate_limited' },
    }, async (ctx) => json(await createReport(ctx.db, ctx.user.id, await ctx.json(LIMITS.small)), 201))
    .add('GET', '/api/reports', { auth: 'Entre na sua conta.', origin: true }, async (ctx) => {
      creatorOnly(ctx);
      return json(await listReports(ctx.db, { status: ctx.url.searchParams.get('status') || 'open' }));
    })
    .add('PATCH', '/api/reports/:reportId', { auth: 'Entre na sua conta.', origin: true }, async (ctx) => {
      creatorOnly(ctx);
      return json(await reviewReport(ctx.db, ctx.user.id, ctx.params.reportId, (await ctx.json(LIMITS.tiny)).status));
    });

  router
    .add('GET', '/api/collaboration/invites', COLLABORATION, async ({ db, user }) => json(await listCollaborationInvites(db, user.id)))
    .add('POST', '/api/collaboration/invites', {
      ...COLLABORATION,
      rateLimit: { key: (ctx) => `collaboration|${ctx.user.id}`, limit: 30, message: 'Muitos convites em pouco tempo. Aguarde um instante.', code: 'rate_limited' },
    }, async (ctx) => json(await createCollaborationInvite(ctx.db, ctx.user.id, await ctx.json(LIMITS.small)), 201))
    .add('POST', '/api/collaboration/invites/:inviteId/respond', COLLABORATION, async (ctx) =>
      json(await respondCollaborationInvite(ctx.db, ctx.user.id, ctx.params.inviteId, await ctx.json(LIMITS.tiny))))
    .add('DELETE', '/api/collaboration/invites/:inviteId', COLLABORATION, async ({ db, user, params }) =>
      json(await cancelCollaborationInvite(db, user.id, params.inviteId)));
}
