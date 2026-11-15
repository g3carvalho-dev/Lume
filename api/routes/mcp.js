// Rotas do servidor MCP Remoto (/api/mcp) e gerenciamento da chave única por conta.

import { LIMITS } from '../config.js';
import { empty, json } from '../http.js';
import {
  authenticateMcpToken, createMcpToken, getMcpTokenInfo, handleMcpRpc, revokeMcpToken,
} from '../domain/mcp.js';

const MCP_RATE_LIMIT = {
  key: (ctx) => `mcp|${ctx.clientIp}`,
  limit: 1000,
  message: 'Muitas chamadas MCP em pouco tempo. Aguarde um instante.',
  code: 'rate_limited',
};

export function mcpRoutes(router) {
  const account = { auth: 'Entre na sua conta para gerenciar o acesso MCP.', origin: true };

  router.add('GET', '/api/mcp/token', account, async (ctx) => {
    return json(await getMcpTokenInfo(ctx.db, ctx.user.id));
  });

  router.add('POST', '/api/mcp/token', account, async (ctx) => {
    const created = await createMcpToken(ctx.db, ctx.user.id);
    ctx.log('mcp_token_created', { userId: ctx.user.id });
    return json(created, 201);
  });

  router.add('DELETE', '/api/mcp/token', account, async (ctx) => {
    const revoked = await revokeMcpToken(ctx.db, ctx.user.id);
    ctx.log('mcp_token_revoked', { userId: ctx.user.id });
    return json(revoked);
  });

  // Endpoint Streamable HTTP para agentes de IA externos (autenticação por Bearer token).
  router.add('POST', '/api/mcp', { rateLimit: MCP_RATE_LIMIT }, async (ctx) => {
    const { userId } = await authenticateMcpToken(ctx.db, ctx.request);
    const body = await ctx.json(LIMITS.body);
    const { status, body: rpcBody } = await handleMcpRpc(ctx.db, userId, body);
    if (status === 202 || rpcBody === null) return empty(202);
    return json(rpcBody, status);
  });

  router.add('GET', '/api/mcp', { rateLimit: MCP_RATE_LIMIT }, async (ctx) => {
    await authenticateMcpToken(ctx.db, ctx.request);
    return json({ name: 'lume-mcp', version: '1.0.0', transport: 'streamable-http' });
  });

  router.add('DELETE', '/api/mcp', { rateLimit: MCP_RATE_LIMIT }, async (ctx) => {
    await authenticateMcpToken(ctx.db, ctx.request);
    return empty(204);
  });
}
