'use strict';
// One monotonically increasing generation protects close/reopen of the SAME video too.
class PlaybackRequestState {
  constructor() { this.generation = 0; this.controller = null; }
  begin() { this.cancel(); this.controller = new AbortController(); return { generation: this.generation, signal: this.controller.signal }; }
  cancel() { this.controller?.abort(); this.controller = null; this.generation++; }
  current(request) { return request.generation === this.generation && !request.signal.aborted; }
  async fetch(request, url, options, fetcher = globalThis.fetch) {
    // Keep provider cookie rotation serialized; retry only the server's busy signal.
    for (let attempt = 0; ; attempt++) {
      if (!this.current(request)) throw new DOMException('Playback cancelled.', 'AbortError');
      const response = await fetcher(url, { ...options, signal: request.signal });
      if (!this.current(request)) throw new DOMException('Playback cancelled.', 'AbortError');
      if (response.status !== 429 || attempt >= 6) return response;
      const data = await response.clone().json().catch(() => ({}));
      if (data.code !== 'REQUEST_BUSY') return response;
      const header = response.headers.get('Retry-After');
      const seconds = header === null ? 1 : Number(header);
      // Refuse unbounded waits; real rate limits are left to the normal error flow.
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 5) return response;
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); reject(new DOMException('Playback cancelled.', 'AbortError')); };
        const timer = setTimeout(() => { request.signal.removeEventListener('abort', abort); resolve(); }, Math.min(5, seconds * 2 ** attempt) * 1000);
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
      });
    }
  }
}
if (typeof module !== 'undefined') module.exports = { PlaybackRequestState };
