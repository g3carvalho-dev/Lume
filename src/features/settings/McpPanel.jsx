import { useState } from 'react';
import { api, apiError } from '../../lib/api.js';
import { useResource } from '../../lib/resources.js';
import { copyText } from '../../lib/clipboard.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Skeleton } from '../../ui/ui.jsx';

function relativeTime(iso) {
  if (!iso) return 'nunca usada';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return 'nunca usada';
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function McpPanel({ account, notify, go }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [freshToken, setFreshToken] = useState('');
  const [clientTab, setClientTab] = useState('claudeCode');
  const resource = useResource('/api/mcp/token', { enabled: Boolean(account) });
  const info = resource.data ?? null;
  const endpointUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://lume.app/api/mcp';

  async function generateToken() {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/mcp/token', { method: 'POST', body: {} });
      if (!result.ok) throw new Error(apiError(result));
      setFreshToken(result.data.token || '');
      await resource.refresh();
      notify('Chave MCP gerada. Copie agora — ela não será exibida completa novamente.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken() {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/mcp/token', { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      setFreshToken('');
      await resource.refresh();
      notify('Chave MCP revogada. Agentes externos não têm mais acesso.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text, message) {
    if (await copyText(text)) {
      notify(message);
    } else {
      notify('Não foi possível copiar automaticamente.');
    }
  }

  const tokenForSnippet = freshToken || 'lume_mcp_COLE_SUA_CHAVE_AQUI';
  const clients = {
    claudeCode: {
      label: 'Claude Code (CLI)',
      steps: [
        'Rode o comando abaixo no terminal (use --scope user para valer em todos os projetos):',
        'Depois, confira a conexão com claude mcp list.',
      ],
      code: `claude mcp add --transport http lume "${endpointUrl}" --scope user --header "Authorization: Bearer ${tokenForSnippet}"`,
    },
    opencode: {
      label: 'OpenCode',
      steps: [
        'Adicione o bloco abaixo ao arquivo opencode.json do projeto ou em ~/.config/opencode/opencode.json:',
        'Mantenha "oauth": false para que o OpenCode envie o cabeçalho Bearer diretamente.',
      ],
      code: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          lume: {
            type: 'remote',
            url: endpointUrl,
            enabled: true,
            oauth: false,
            headers: {
              Authorization: `Bearer ${tokenForSnippet}`,
            },
          },
        },
      }, null, 2),
    },
    cursor: {
      label: 'Cursor / Antigravity',
      steps: [
        'Abra as configurações de MCP (ex.: ~/.cursor/mcp.json ou .cursor/mcp.json no projeto):',
        'Cole a configuração abaixo e recarregue os servidores MCP.',
      ],
      code: JSON.stringify({
        mcpServers: {
          lume: {
            url: endpointUrl,
            headers: {
              Authorization: `Bearer ${tokenForSnippet}`,
            },
          },
        },
      }, null, 2),
    },
    claudeDesktop: {
      label: 'Claude Desktop',
      steps: [
        'No Claude.ai (Web/Desktop), você também pode usar Configurações → Conectores → Adicionar conector personalizado.',
        'Ou adicione ao claude_desktop_config.json usando a ponte mcp-remote (exige Node.js):',
      ],
      code: JSON.stringify({
        mcpServers: {
          lume: {
            command: 'npx',
            args: [
              '-y',
              'mcp-remote',
              endpointUrl,
              '--header',
              `Authorization: Bearer ${tokenForSnippet}`,
            ],
          },
        },
      }, null, 2),
    },
    chatgpt: {
      label: 'ChatGPT',
      steps: [
        'No ChatGPT (Plus/Pro/Team/Enterprise), abra Configurações → Conectores → Configurações avançadas e ative o Modo de desenvolvedor.',
        'Clique em Criar conector e informe a URL HTTPS do servidor abaixo.',
        'Observação: a interface web do ChatGPT aceita OAuth ou servidores sem cabeçalho customizado; para usar chave Bearer estática hoje, utilize um proxy intermediário ou clientes compatíveis com header (Claude Code, OpenCode, Cursor).',
      ],
      code: `URL do conector: ${endpointUrl}`,
    },
    curl: {
      label: 'cURL',
      steps: ['Execute no terminal para validar que o endpoint e sua chave estão respondendo:'],
      code: `curl -X POST "${endpointUrl}" \\\n  -H "Authorization: Bearer ${tokenForSnippet}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
  };
  const currentClient = clients[clientTab] || clients.claudeCode;

  if (!account) {
    return <div className="cfg-block mcp-block">
      <div className="mcp-head">
        <div>
          <h3>Agentes de IA (MCP)</h3>
          <p className="cfg-sub">Conecte Claude, Cursor ou outros agentes compatíveis ao seu Lume.</p>
        </div>
        <span className="soft-badge mono">Conta necessária</span>
      </div>
      <p className="inline-note"><Icon name="lock"/><span>Entre na sua conta para gerar uma chave de acesso MCP.</span></p>
      <div>
        <Button secondary onClick={() => go('login')}>Entrar para conectar<Icon name="arrow"/></Button>
      </div>
    </div>;
  }

  return <div className="cfg-block mcp-block">
    <div className="mcp-head">
      <div>
        <h3>Agentes de IA (MCP)</h3>
        <p className="cfg-sub">Permita que assistentes externos leiam seu progresso, criem tarefas, agendem compromissos e deem feedback — sem gerar XP nem excluir dados.</p>
      </div>
      {info && <span className={`soft-badge mono ${info.active ? 'is-active-mcp' : ''}`}>
        {info.active ? 'Chave ativa' : 'Desconectado'}
      </span>}
    </div>

    <div className="mcp-field-row">
      <span className="mcp-label">Endpoint MCP (Streamable HTTP)</span>
      <div className="mcp-copy-box">
        <code className="mono">{endpointUrl}</code>
        <Button secondary onClick={() => copy(endpointUrl, 'URL do servidor MCP copiada.')}>Copiar URL</Button>
      </div>
    </div>

    {!info && <Skeleton label="Verificando chave MCP…" rows={2}/>}

    {freshToken && <div className="mcp-fresh-banner" role="status">
      <div className="mcp-fresh-head">
        <strong>Copie sua chave agora</strong>
        <span className="mono">Exibida uma única vez</span>
      </div>
      <div className="mcp-copy-box">
        <code className="mono">{freshToken}</code>
        <Button onClick={() => copy(freshToken, 'Chave MCP copiada.')}>Copiar chave</Button>
      </div>
    </div>}

    {info && !info.active && <div className="action-row">
      <Button onClick={generateToken} disabled={busy}><Icon name="plus"/>Gerar chave de acesso</Button>
    </div>}

    {info && info.active && <div className="mcp-active-card">
      <div className="mcp-active-meta">
        <code className="mono">{info.prefix}</code>
        <small>Criada em {new Date(info.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · último uso: {relativeTime(info.lastUsedAt)}</small>
      </div>
      <div className="action-row">
        <Button secondary onClick={generateToken} disabled={busy}><Icon name="restart"/>Regenerar</Button>
        <button type="button" className="text-button is-danger-text" onClick={revokeToken} disabled={busy}>Revogar</button>
      </div>
    </div>}

    <div className="mcp-snippet">
      <div className="mcp-tabs" role="tablist" aria-label="Como conectar por ferramenta">
        {Object.entries(clients).map(([id, item]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={clientTab === id}
            className={`filter-btn ${clientTab === id ? 'is-active' : ''}`}
            onClick={() => setClientTab(id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ol className="mcp-guide-steps">
        {currentClient.steps.map((step, index) => <li key={index}>{step}</li>)}
      </ol>
      <div className="mcp-code-box">
        <div className="mcp-code-head">
          <span className="mono">{currentClient.label}</span>
          <Button secondary onClick={() => copy(currentClient.code, 'Comando/configuração copiado.')}>Copiar</Button>
        </div>
        <pre className="mono"><code>{currentClient.code}</code></pre>
      </div>
    </div>

    <div className="mcp-permissions">
      <span className="mcp-label">Escopo de permissões</span>
      <div className="mcp-pills">
        <span className="soft-badge is-allowed"><Icon name="check"/>Ler progresso e ritmo</span>
        <span className="soft-badge is-allowed"><Icon name="check"/>Criar tarefas e agendar</span>
        <span className="soft-badge is-allowed"><Icon name="check"/>Organizar materiais</span>
        <span className="soft-badge"><Icon name="lock"/>Sem concluir aulas / XP</span>
        <span className="soft-badge"><Icon name="lock"/>Sem exclusões</span>
      </div>
    </div>

    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
