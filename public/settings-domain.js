import { normalizeProfileCard, normalizeSoundscape } from './domain.js';
import { normalizePrivacy } from './privacy-domain.js';
import { endSession } from './session-domain.js';

export function setPreference(state, key, value) {
  if (key === 'watchLessons' && value === false && state.activeSession?.origin === 'watching') state = endSession(state).state;
  const normalized = key === 'soundscape'
    ? normalizeSoundscape(value, state.preferences?.soundscape || 'off')
    : key === 'textSize'
      ? (value === 'large' ? 'large' : 'normal')
      : value;
  return { ...state, preferences: { ...state.preferences, [key]: normalized, ...(key === 'weeklyGoal' ? { weeklyGoalSource: 'manual' } : {}) } };
}

export function setSharingPreference(state, key, value) {
  return { ...state, preferences: { ...state.preferences, sharing: { ...state.preferences.sharing, [key]: value } } };
}

// Privacidade do perfil: chave geral (`mode`) ou alcance de uma seção. A antiga
// chave `sharing.public` acompanha a geral, só por compatibilidade dos dados.
export function setPrivacy(state, patch) {
  const privacy = normalizePrivacy({ privacy: { ...normalizePrivacy(state.preferences), ...patch } });
  return {
    ...state,
    preferences: {
      ...state.preferences,
      privacy,
      sharing: { ...state.preferences.sharing, public: privacy.mode === 'open' },
    },
  };
}

export function setProjectSharing(state, id, shared) {
  return { ...state, courses: state.courses.map((course) => course.id === id ? { ...course, shared } : course) };
}

export function updateProfile(state, patch) {
  return { ...state, profile: normalizeProfileCard({ ...state.profile, ...patch }) };
}
