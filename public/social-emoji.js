// Emojis oferecidos nas reações, no compositor e nos comentários, e a regra dos
// GIFs. O servidor só aceita reações desta lista e GIFs do provedor liberado.
export const EMOJI_GROUPS = [
  { id: 'faces', title: 'Rostos', icon: 'smile', items: [
    ['😄', 'sorriso feliz'], ['😂', 'rindo'], ['🥹', 'emocionado'], ['😎', 'óculos legal'], ['😍', 'apaixonado'],
    ['😭', 'chorando'], ['🤔', 'pensando'], ['😅', 'alívio suor'], ['🙌', 'mãos para cima celebrar'], ['👍', 'joinha curtir'],
    ['😊', 'sorriso'], ['🥰', 'carinho'], ['😴', 'sono'], ['😮', 'surpresa'], ['😢', 'triste'],
    ['😡', 'bravo'], ['🤯', 'mente explodindo'], ['🥳', 'festa'], ['🤓', 'nerd estudo'], ['🙃', 'invertido'],
    ['😉', 'piscadinha'], ['🫡', 'continência'], ['🤝', 'acordo aperto de mão'], ['👏', 'palmas'], ['🙏', 'obrigado por favor'],
  ] },
  { id: 'animals', title: 'Animais', icon: 'paw', items: [
    ['🐱', 'gato'], ['🐶', 'cachorro'], ['🦊', 'raposa'], ['🐼', 'panda'], ['🦉', 'coruja'],
    ['🐢', 'tartaruga'], ['🦋', 'borboleta'], ['🐝', 'abelha'], ['🐙', 'polvo'], ['🦄', 'unicórnio'],
  ] },
  { id: 'food', title: 'Comida', icon: 'coffee', items: [
    ['☕', 'café'], ['🍕', 'pizza'], ['🍫', 'chocolate'], ['🍎', 'maçã'], ['🥑', 'abacate'],
    ['🍿', 'pipoca'], ['🧁', 'bolinho'], ['🍉', 'melancia'], ['🥤', 'bebida'], ['🍪', 'biscoito'],
  ] },
  { id: 'activities', title: 'Atividades', icon: 'ball', items: [
    ['🎯', 'alvo meta'], ['🏆', 'troféu'], ['🎉', 'festa confete'], ['🎮', 'jogo'], ['🎧', 'fone música'],
    ['📚', 'livros estudo'], ['✏️', 'lápis'], ['📝', 'anotação'], ['💻', 'computador'], ['🧠', 'cérebro'],
  ] },
  { id: 'places', title: 'Viagem', icon: 'car', items: [
    ['🚀', 'foguete'], ['🌍', 'mundo'], ['🏠', 'casa'], ['🚗', 'carro'], ['✈️', 'avião'],
    ['🌙', 'lua'], ['☀️', 'sol'], ['🌧️', 'chuva'], ['🌈', 'arco-íris'], ['⭐', 'estrela'],
  ] },
  { id: 'objects', title: 'Objetos', icon: 'bulb', items: [
    ['💡', 'ideia'], ['⏰', 'despertador'], ['📌', 'alfinete'], ['🔔', 'sino'], ['🔑', 'chave'],
    ['📎', 'clipe'], ['🎓', 'formatura'], ['🔥', 'fogo'], ['⚡', 'raio'], ['🧩', 'quebra-cabeça'],
  ] },
  { id: 'symbols', title: 'Símbolos', icon: 'heart', items: [
    ['❤️', 'coração vermelho'], ['💙', 'coração azul'], ['💜', 'coração roxo'], ['💚', 'coração verde'], ['💛', 'coração amarelo'],
    ['✨', 'brilho'], ['💯', 'cem'], ['✅', 'feito check'], ['❓', 'dúvida'], ['❗', 'atenção'],
  ] },
];

export const QUICK_REACTIONS = ['❤️', '😂', '🥹', '🙌', '✨', '👍'];
export const DEFAULT_REACTION = '❤️';

const ALLOWED = new Set(EMOJI_GROUPS.flatMap((group) => group.items.map(([emoji]) => emoji)));
export function isAllowedEmoji(value) {
  return typeof value === 'string' && ALLOWED.has(value);
}

// GIFs vêm do Giphy; só endereços dos servidores de mídia dele são aceitos.
const GIF_URL = /^https:\/\/(?:media\d*|i)\.giphy\.com\/[A-Za-z0-9_\-./%]+(?:\?[A-Za-z0-9_\-.=&%]*)?$/;
export function isGifUrl(value) {
  return typeof value === 'string' && value.length <= 400 && GIF_URL.test(value);
}
