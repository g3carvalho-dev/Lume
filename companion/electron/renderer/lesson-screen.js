const provider = new URLSearchParams(location.search).get('provider');
document.getElementById('provider').textContent = provider;
window.updateLesson = ({lessonTitle, courseTitle, duration}) => {
  for (const [id, value] of [['lesson',lessonTitle],['course',courseTitle]]) {
    if (typeof value !== 'string') continue;
    const el = document.getElementById(id);
    el.textContent = value;
    el.title = value;
  }
  document.getElementById('duration').textContent = '—';
  if (duration > 0 && Number.isFinite(duration)) {
    const seconds = Math.round(duration);
    const hours = Math.floor(seconds/3600);
    const minutes = Math.floor(seconds/60)%60;
    document.getElementById('duration').textContent = (hours ? hours+':'+String(minutes).padStart(2,'0') : minutes) + ':' + String(seconds%60).padStart(2,'0');
  }
};
