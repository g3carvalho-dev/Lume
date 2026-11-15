// Denúncias: motivos aceitos e limites. As denúncias vão para a conta criadora
// do Lume (LUME_CREATOR_EMAIL); quem denuncia não é identificado para a pessoa
// denunciada.
export const REPORT_REASONS = {
  harassment: 'Assédio, ameaça ou ofensa',
  spam: 'Spam ou propaganda',
  inappropriate: 'Conteúdo impróprio',
  scam: 'Golpe ou fraude',
  impersonation: 'Se passa por outra pessoa',
  other: 'Outro motivo',
};
export const REPORT_CONTEXTS = ['direct', 'group', 'post'];
export const REPORT_DETAILS_LIMIT = 500;
export const REPORT_EVIDENCE_MESSAGES = 10;
export const REPORT_EVIDENCE_TEXT = 500;
export const REPORT_STATUS = { open: 'Aberta', reviewed: 'Analisada', dismissed: 'Arquivada' };

// Grupos de conversa entre amigos.
export const GROUP_NAME_LIMIT = 60;
export const GROUP_MIN_OTHERS = 2;
export const GROUP_MAX_MEMBERS = 20;
