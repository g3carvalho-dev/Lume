import { EXTENSION_STORE_URL, extensionCapability, supportedExtensionVersion, supportsCourseExtension } from '../../../public/extension-domain.js';
import { useExtension } from '../../lib/extension.js';
import Icon from '../../ui/Icon.jsx';

export default function ExtensionInvite({ provider }) {
  const { installed, version, check } = useExtension();
  const supported = supportsCourseExtension(navigator.userAgent, navigator.maxTouchPoints);
  const current = installed && supportedExtensionVersion(version);
  return <section className="extension-invite" aria-label="Extensão do Lume">
    <h3><Icon name="book"/>{current ? 'Extensão instalada' : 'Extensão do Lume'}</h3>
    {(!supported && !installed) ? <p>A extensão funciona no Chrome e no Edge do computador. Para importar aqui, escolha “Colar a grade”.</p>
      : current ? <ol><li>Abra o curso na plataforma com a sua conta.</li><li>Clique no ícone do Lume e em “Ler este curso”.</li><li>Revise aqui as aulas que deseja adicionar.</li></ol>
      : installed === null ? <p role="status">Verificando a extensão…</p>
      : <><p>{installed ? `A versão ${version} está instalada. Atualize a extensão e recarregue esta página.` : extensionCapability(provider)}</p>
        {!installed && <p>Você revisa a leitura aqui antes de salvar. Se já usa uma versão anterior, atualize a extensão e recarregue esta página.</p>}
        <div className="extension-invite-actions"><a className="button secondary" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">{installed ? 'Atualizar a extensão' : 'Instalar a extensão'}<Icon name="external"/></a>
          <button className="text-button" type="button" onClick={check}>Já instalei</button></div></>}
  </section>;
}
