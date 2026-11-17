import { ipcRenderer } from 'electron';
import { observeLesson } from './observe-lesson.js';

// O preload roda no mundo isolado. A página da plataforma não recebe uma ponte IPC.
window.addEventListener('DOMContentLoaded', () => {
  if (window === top) observeLesson(message => ipcRenderer.invoke('lesson-watch', message));
}, {once:true});
