import SectionTabs from '../../app/SectionTabs.jsx';
import { Heading } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';

// Moldura comum das quatro abas do Social (Feed, Mensagens, Ranking e Amigos):
// o mesmo cabeçalho, as abas no mesmo lugar e a mesma largura de página. Cada
// aba compõe o próprio conteúdo dentro dela. `wide` deixa o corpo ocupar a altura
// restante da janela (Mensagens).
export default function SocialFrame({ route, account, lead = 'Compartilhe seus estudos e converse com seus amigos.', actions, className = '', children }) {
  const unreadSummary = useResource('/api/messages/unread', { interval: 45000, enabled: Boolean(account) });
  const unread = account && unreadSummary.data?.notifications !== false ? Number(unreadSummary.data?.unread) || 0 : 0;
  return <div className={`social-root social-frame ${className}`}>
    <Heading title="Social" actions={actions}>{lead}</Heading>
    <SectionTabs route={route} unread={unread}/>
    {children}
  </div>;
}
