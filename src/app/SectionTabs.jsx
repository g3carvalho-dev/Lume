// Abas de uma seção da navegação principal. Cada aba é um hash próprio, então
// voltar, recarregar e compartilhar o endereço continuam funcionando. As abas
// vêm da tabela de rotas (src/app/routes.jsx).
import { useEffect, useRef } from 'react';
import { SECTIONS, sectionOf, tabsOf } from './routes.jsx';
import Icon from '../ui/Icon.jsx';

export { SECTIONS, sectionOf };

export default function SectionTabs({ route }) {
  const key = sectionOf(route);
  const section = SECTIONS[key];
  const tabs = key ? tabsOf(key) : [];
  const ref = useRef(null);
  // No celular as abas rolam na horizontal: a aba aberta fica à vista.
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector('.section-tab.active');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    nav.scrollLeft = left - (nav.clientWidth - active.offsetWidth) / 2;
  }, [route]);
  if (!section || tabs.length < 2) return null;
  return <nav ref={ref} className="section-tabs" aria-label={`Seções de ${section.label}`}>
    {tabs.map(([path, label, icon]) => <a key={path} href={`#${path}`} className={`section-tab ${route === path ? 'active' : ''}`} aria-current={route === path ? 'page' : undefined}>
      {icon && <Icon name={icon}/>}{label}
    </a>)}
  </nav>;
}
