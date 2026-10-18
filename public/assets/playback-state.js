'use strict';
// One monotonically increasing generation protects close/reopen of the SAME video too.
class PlaybackRequestState {
  constructor() { this.generation = 0; this.controller = null; }
  begin() { this.cancel(); this.controller = new AbortController(); return { generation: this.generation, signal: this.controller.signal }; }
  cancel() { this.controller?.abort(); this.controller = null; this.generation++; }
  current(request) { return request.generation === this.generation && !request.signal.aborted; }
  async fetch(request, url, options, fetcher = globalThis.fetch) {
    // A single user action makes one request. Automatic retries count toward
    // the server's playback limit and can turn REQUEST_BUSY into RATE_LIMIT.
    if (!this.current(request)) throw new DOMException('Playback cancelled.', 'AbortError');
    const response = await fetcher(url, { ...options, signal: request.signal });
    if (!this.current(request)) throw new DOMException('Playback cancelled.', 'AbortError');
    return response;
  }
}
if (typeof module !== 'undefined') module.exports = { PlaybackRequestState };
