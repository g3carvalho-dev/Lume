import { observeLesson } from './observe-lesson.js';

// Este módulo só é avaliado no mundo isolado que o host cria para a aula.
const outgoing = [];
const replies = new Map();
let sequence = 0;
globalThis.lumeEdgeObserver = {
  drain: () => outgoing.splice(0),
  reply(id, result) { replies.get(id)?.(result); replies.delete(id); }
};
observeLesson(message => new Promise(resolve => {
  const id = ++sequence;
  replies.set(id, resolve);
  outgoing.push({id, message});
}));
