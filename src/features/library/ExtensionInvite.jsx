import { EXTENSION_STORE_URL, supportedExtensionVersion, supportsCourseExtension } from '../../../public/extension-domain.js';
import { useExtension } from '../../lib/extension.js';
import Icon from '../../ui/Icon.jsx';

export default function ExtensionInvite() {
  const { installed, version, check } = useExtension();
  const supported = supportsCourseExtension(navigator.userAgent, navigator.maxTouchPoints);
  const current = installed && supportedExtensionVersion(version);
  const available = supported || installed;
  return <section className="extension-invite" aria-label="Extensão do Lume">
    <h3><Icon name="book"/>{current ? 'Extensão instalada' : 'Extensão do Lume'}</h3>
    <p>A extensão lê as aulas do curso aberto em uma plataforma compatível e envia a grade para você revisar no Lume.</p>
    {!available
      ? <p>A extensão funciona no Chrome e no Edge do computador. Importe o curso por lá usando a mesma conta do Lume; ele também ficará disponível aqui.</p>
      : !current && <p>Abra a página da extensão pelo botão abaixo e confirme a instalação no navegador.</p>}
    <ol>
      <li>Abra o curso na plataforma com a sua conta.</li>
      <li>Clique no ícone do Lume e em “Ler este curso”.</li>
      <li>Revise aqui as aulas e confirme para adicionar à biblioteca.</li>
    </ol>
    {available && installed === null && <p role="status">Verificando a extensão…</p>}
    {installed && !current && <p>A versão {version} está instalada. Atualize a extensão e recarregue esta página.</p>}
    <div className="extension-invite-actions">
      <a className={`button ${current || !available ? 'secondary' : 'primary'}`} href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">{current || !available ? 'Ver extensão na loja' : installed ? 'Atualizar a extensão' : 'Instalar a extensão'}<Icon name="external"/></a>
      {available && !current && <button className="text-button" type="button" onClick={check} disabled={installed === null}>Já instalei</button>}
    </div>
  </section>;
}
