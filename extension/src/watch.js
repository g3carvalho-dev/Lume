import { observeLesson } from './observe-lesson.js';
import { watchBadge } from './watch-badge.js';
import { providerForUrl } from '../../public/providers/registry.js';

if (!globalThis.lumeStopWatch && window === top) {
  const stop = observeLesson(message => chrome.runtime.sendMessage(message), watchBadge);
  if (stop) {
    const provider = providerForUrl(location.href);
    function cleanup() {
      stop();
      chrome.runtime.onMessage.removeListener(control);
      delete globalThis.lumeStopWatch;
    }
    function control(message) {
      if (message?.type === 'watch-stop' && message.provider === provider.id) cleanup();
    }
    globalThis.lumeStopWatch = cleanup;
    chrome.runtime.onMessage.addListener(control);
  }
}
