export const WATCH_COMPLETION_RATIO = 0.9;
export const WATCH_HEARTBEAT_MS = 30000;
export const MAX_WATCH_RATE = 2;
const CLOCK_TOLERANCE_SECONDS = 2;

export function mergePlayed(previous, played, duration) {
  const ranges = [...previous, ...played].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of ranges) {
    if (b <= a) continue;
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export const coverageSeconds = ranges => ranges.reduce((total, [a, b]) => total + b - a, 0);

// Limitar o tamanho de mensagens e linhas. Descartar os menores trechos é
// conservador: juntar dois trechos separados contaria a parte que foi pulada.
export function limitPlayed(ranges, limit) {
  if (ranges.length <= limit) return ranges;
  return [...ranges].sort(([a,b],[c,d]) => (d-c)-(b-a)).slice(0,limit).sort(([a],[b]) => a-b);
}

// Só os trechos novos desde a última amostra pertencem a este acompanhamento.
export function newPlayedRanges(current, previous) {
  const added = [];
  for (const [start, end] of current) {
    let cursor = start;
    for (const [a, b] of previous) {
      if (a >= end) break;
      if (a > cursor) added.push([cursor, Math.min(a, end)]);
      cursor = Math.max(cursor, b);
      if (cursor >= end) break;
    }
    if (cursor < end) added.push([cursor, end]);
  }
  return added;
}
export function acceptedCoverage(reported, duration, playingSeconds) {
  return Math.min(duration, Math.max(0, reported), playingSeconds > 0 ? playingSeconds * MAX_WATCH_RATE + CLOCK_TOLERANCE_SECONDS : 0);
}
export function watchCompleted({ platformReader, seenPending, platformDone, covered, duration }) {
  return platformReader ? seenPending && platformDone === true : duration > 0 && covered >= duration * WATCH_COMPLETION_RATIO;
}
