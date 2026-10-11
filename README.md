# Secure Course Search — v1.10.1

## v1.10.1 playback and cookie fixes

- Rapid close/reopen and video switches retry only `REQUEST_BUSY`, honoring `Retry-After` with up to six retries and a maximum five-second delay per retry. Retries stop when the player selection changes, closes, disconnects, or logs out. Provider calls remain serialized for safe cookie rotation; ordinary rate limits are not retried.
- Cookie expiration explicitly distinguishes a missing expiration from Unix timestamp zero, including when restoring saved cookie jars.
- Added regression tests for busy recovery, bounded retries, cancellation, epoch-expired cookies, and Chromium close/reopen and video-switch races.

## Per-viewer Infinity accounts (v1.10)

**Live authentication and playback are unverified.** Public-page inspection on October 11, 2026 confirmed the POST login form, `_token`, `email`, `password`, optional `remember`, and browser-derived `visitor_id`. Node received initial `XSRF-TOKEN`/`jessor_session` cookies and an unauthenticated dashboard redirect. No authorized account was used. Mocked tests do not prove Infinity accepts this server-side login flow.

### Connect, disconnect and reconnect

1. Enter Course Search with your existing access code.
2. Select **Connect Infinity account**, enter your own Infinity email/password, then **Connect**. Selecting **Watch** while disconnected opens the same dialog and resumes that video after a confirmed connection.
3. Every **Watch**, **Refresh video link**, and video **Open** requests the current source with this viewer's Infinity session. A valid URL may be returned unchanged on successive requests.
4. Select **Disconnect** to remove the saved provider authentication. **Log out** also revokes the Course Search session. Expired/rejected Infinity sessions prompt reconnection; access denial is shown without granting access.

Passwords are used only during login, cleared from the form upon submission, and never saved or logged. Initial cookies and the security token are obtained server-side, the form is submitted with that same cookie jar, provider-origin redirects and cookie updates are processed, and `/student_dashboard/home` is checked for positive authenticated-page evidence (dashboard navigation and a logout action). Unfamiliar pages are rejected rather than falsely reported as connected.

The dialog discloses device-data use. The inspected Infinity algorithm runs on the **actual viewer's browser**, with the same property order, SHA-256 encoding, WebGL and audio measurements. No fabricated fingerprint, approved-device impersonation, CAPTCHA bypass or two-factor bypass is supplied. Its reproducibility across origins/browser privacy settings, server/browser IP differences and the provider's acceptance of this integration **remain unverified**. A device restriction, challenge or unrecognized response fails closed. Opening Infinity's login page elsewhere does not let this website read its cookies.

### Required encryption key and upgrade

Set `INFINITY_AUTH_KEY` as a **private environment variable**, separate from `SESSION_SECRET`. Generate a dedicated 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the result privately into `INFINITY_AUTH_KEY`; never put it in source control, a ZIP, course records or the state volume. `npm run setup` creates a private local `.env` with a generated key for a new installation; do not run `--force` over an existing installation. Back up the key privately and independently of state. Losing/changing it prevents old encrypted records from being authenticated; there is no plaintext fallback or automatic key rotation. Arrange an operator-managed migration/reconnection rather than silently replacing it.

Encrypted material is stored under `STATE_DIR/private-auth` (directory `0700`, files `0600`) using AES-256-GCM with random nonces and viewer identity bound as authenticated additional data. Every Course Search login receives a random 256-bit identity, even when several viewers use one access code. Viewer connections expire after **12 hours**, or earlier when Course Search/provider authentication expires. Course Search sessions retain their existing seven-day lifetime; admin sessions eight hours. Cleanup runs at startup and every five minutes. Disconnect removes the cookie jar; logout retains only an encrypted revocation marker until session expiry, so copying an old signed cookie cannot undo logout, even across a restart. In-flight work is generation-checked and cannot restore a disconnected connection.

For upgrades, first back up existing state and configure the key. An existing plaintext `STATE_DIR/infinity-auth.json` is encrypted into the separate admin record, read back and verified, then atomically replaced with a migration marker. Missing/wrong keys, malformed plaintext, conflicting encrypted records, or failed verification stop startup without deleting the original file. Migration is idempotent. An interrupted migration can leave both files; retain them and retry with the same key. Existing backups may still contain plaintext: protect them and retire them under your retention policy. Filesystem snapshots/SSD history cannot be securely erased by an atomic replacement.

Existing v1.9 browser sessions must sign in again once after upgrading because they have no unique session identity. Access codes, admin permissions, labels, favorites and the editable guide remain supported.

### Production requirements

- Run **one Node process/instance**, Node.js >=20, with persistent private `STATE_DIR` storage. Multi-worker/multi-instance authentication coordination is not implemented; do not share this volume between concurrently running servers.
- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and `APP_ORIGIN=https://your-real-site.example` (no trailing slash). Terminate HTTPS with a trusted reverse proxy; do not expose the Node HTTP port publicly. Cookies are Secure, HttpOnly and SameSite=Strict. Browser fingerprint hashing requires a secure context (HTTPS; loopback HTTP is allowed for local testing).
- Connection, disconnection, viewer playback and viewer logout require a session-bound CSRF token. Cross-origin mutations are rejected. Responses containing private state/playback use `Cache-Control: no-store`; disable upstream proxy caching for `/api/` and authenticated pages. Ensure the proxy does not log request bodies, cookies or private response bodies.
- IP forwarding headers are ignored by default. Set `TRUST_PROXY=true` only when a trusted proxy overwrites those headers and direct public access to Node is blocked. The application does not independently verify a proxy-address allowlist.
- Login is limited to five attempts per ten minutes per viewer/IP. Viewer playback is limited to 30 requests per minute per viewer/IP, with one in-flight provider operation per viewer. Failed/rejected calls count. Upstream rate limits and failures are not retried as credential submissions.
- `INFINITY_COOKIE` and the admin cookie panel remain **catalog-administration-only**. Saved admin cookies are encrypted too. Scanner and metadata requests never use a viewer's session; student playback never uses an admin cookie or a stored shared source.
- Known library CDN hosts are explicitly listed in `data/playback-hosts.json`. To authorize a newly verified official CDN hostname, set comma-separated `INFINITY_PLAYBACK_HOSTS` (hostnames only, no schemes/ports/wildcards). Do not add a host merely to bypass provider restrictions. Official Bunny embed URLs are restricted to `iframe.mediadelivery.net/embed/{library}/{guid}`. Provider HTML/scripts are never executed; only a validated URL is extracted.

Student catalogs contain metadata and source-availability flags, not saved video URLs/embeds. Viewer-specific sources never enter the shared course database or browser storage. Non-video navigation links retain their existing behavior. Admin-assigned Bunny URLs remain editable catalog metadata, **not** a viewer-playback fallback: the current authorized provider response must itself return a supported source. If Infinity only returns an unfamiliar player format, playback stops rather than using the stored assignment.

CDN domain allowlists, IP binding and token expiration still apply. There is no video proxy, forged referrer, credential-sharing fallback, or claim that delivered URLs/JavaScript can be hidden from the viewer. A provider-bound server IP may make browser playback unusable; the integration cannot bypass that. Challenges/device blocks need provider assistance or a provider-supported integration. Do not send passwords to support/logs; use the authenticated connection dialog for any separately authorized private live test.

### Verification and clean packaging

```bash
npm run check
npm test
python3 scripts/package.py /path/to/secure_course_search_v1.10.1_per_user_infinity.zip
```

Tests mock all Infinity traffic with synthetic credentials and cover login tokens/cookie rotation, positive authentication evidence, challenges/denial, CSRF, viewers sharing a code, fresh playback isolation, encryption/tampering, legacy migration, expiry, races and rate limits. Tests use `/tmp/opencode` scratch directories (create that directory on other machines before testing).

Build verification completed with Node.js 22.23.1: syntax checks and 22 mocked/server security tests passed. A headless Chromium smoke test passed connection/resume, two separate browser viewers sharing an access code, repeated Watch/Refresh/Open, guide expansion, focus restoration, close races, expiry/reconnect, mobile layout and logout. Live authentication and live CDN media remain untested.

Optional browser smoke testing uses a separately installed Playwright tool, not a runtime dependency. Install Playwright/Chromium outside the app and run `npm run test:browser` with `PLAYWRIGHT_MODULE` set to its module path and `PLAYWRIGHT_BROWSERS_PATH` to its browser directory. All browser media requests are blocked; this checks the interface, not live provider playback.

The packaging script uses an explicit source allowlist, resets bundled access codes to an empty array, excludes `.env`, credentials, private authentication, caches, test artifacts and dependencies, and strips saved video sources from the archive's bundled catalog while retaining searchable metadata/availability flags. It never overwrites an existing destination ZIP. Keep the original v1.9 ZIP unchanged. No deployment is performed by setup/tests/packaging.

A private web app for searching the uploaded course CSV. The course dataset is served only after authentication, access codes are managed from a separate admin panel, and all course items sharing the same Lesson ID are grouped into one lesson card.

## Features

- Server-side access-code login — not a fake JavaScript password prompt
- HttpOnly, SameSite session cookies signed with HMAC-SHA256
- Admin panel at `/admin`
- Generate random codes or create custom codes
- Optional expiry time and maximum login count per code
- Revoke/re-enable, reset usage, or delete codes
- Login rate limiting
- Course JSON blocked for unauthenticated visitors
- 3,956 bundled course/video rows plus admin-side live Video ID fetching
- Search, filters, grid/list layouts, and course details
- Fetch/add or refresh an Infinity course item directly from the admin panel by Video ID
- Persistent course updates on the Railway volume
- Zero npm dependencies; Node.js 20+ only

## Run locally

```bash
npm run setup
npm start
```

`npm run setup` creates a private `.env` file and prints a randomly generated admin password. Save that password.

Then open:

- Normal site: `http://localhost:3000/`
- Admin panel: `http://localhost:3000/admin`

Sign in to the admin panel, create an access code, and give that code only to people who should be able to enter the course search.

## Environment variables

If you prefer to configure it manually, copy `.env.example` to `.env` and set:

- `PORT` — server port, default `3000`
- `ADMIN_PASSWORD` — unique admin-panel password; at least 12 characters
- `SESSION_SECRET` — random secret; at least 32 characters
- `INFINITY_AUTH_KEY` — required dedicated encryption key; see v1.10 instructions above.
- `COOKIE_SECURE` — set `true` behind HTTPS. Secure cookies are also enabled automatically when `NODE_ENV=production`.
- `STATE_DIR` — persistent state directory in production; use `/data` on Railway.
- `INFINITY_COOKIE` — optional Infinity School Cookie header. If omitted, an admin can save/replace it from `/admin`; the value is never returned to the browser.

## Deployment

This is intentionally **not** a GitHub Pages/static-only project. Static hosting cannot keep the course data or access-code logic private.

Deploy it to a Node.js host with a **persistent filesystem/volume**. Access codes, labels, the live course database, and the optional saved Infinity cookie all live under `STATE_DIR`, so that directory must survive application restarts/redeploys.

Recommended deployment shape:

1. Put the project in a private Git repository. `.env` is ignored by Git.
2. Set `ADMIN_PASSWORD`, `SESSION_SECRET` and `INFINITY_AUTH_KEY` as private environment variables on the host, plus the production requirements above.
3. Use `npm start` as the start command.
4. Attach persistent storage for `data/access-codes.json` (or the whole `data/` directory).
5. Serve the app over HTTPS.

If your host has an ephemeral/read-only filesystem, move the access-code store to a database before relying on admin changes to persist.

## Security behavior

- Plaintext access codes are shown only when they are created. They are not stored on disk.
- The server stores a keyed HMAC digest plus the final four-character hint for identification.
- Revoking or expiring a code invalidates sessions created with that code on their next protected request.
- Hitting a max-login count blocks **new** logins. It does not eject a session that is already logged in; revoke the code for immediate invalidation.
- The course data endpoint returns `401` unless a valid access/admin session exists.
- Keep `.env` and `SESSION_SECRET` private.

## Replace/update the CSV later

Keep the CSV outside `public/`, then run:

```bash
python3 scripts/import_csv.py /path/to/videos_course_info.csv
```

That rebuilds the bundled `data/courses.json`. On production, admin-fetched items are kept in the persistent `STATE_DIR/courses.json`.

## Lesson grouping (v1.2)

Search results are grouped by the exact `lessonId`. Each lesson appears once as an expandable group, and every video/resource with that same Lesson ID is listed inside the group. Search and filters decide which lesson groups appear, while opening a group shows all items belonging to that lesson. Static frontend assets are served with `no-store` to prevent an older cached UI from surviving an update.


## Subject & teacher names (v1.3)

The admin panel includes a **Subject & teacher names** section. It maps the numeric IDs in `courses.json` to readable labels stored in `data/labels.json`. Changes take effect on the search page immediately after saving and do not modify the original course dataset.

All subject IDs are prefilled. Verified teacher names are prefilled; unnamed teachers are shown first in the admin panel and include their subject plus an example lesson so they are easy to identify. Unnamed entries fall back to `Teacher <id>` until an admin saves a readable name.

## Production deployment (Railway)

This build supports persistent admin state through `STATE_DIR`. For Railway, attach a volume at `/data` and set `STATE_DIR=/data`. The first boot copies the bundled subject/teacher labels into the volume and creates an empty access-code store if needed.

Recommended variables:

```text
NODE_ENV=production
COOKIE_SECURE=true
STATE_DIR=/data
ADMIN_PASSWORD=<long unique password>
SESSION_SECRET=<random value, 32+ characters>
INFINITY_AUTH_KEY=<dedicated base64-encoded 32-byte key>
APP_ORIGIN=<actual HTTPS origin, no trailing slash>
```

Use `npm start` as the start command and `/health` as the healthcheck path.

## Direct Infinity Video ID fetch (v1.4)

The admin panel can fetch a course item directly from Infinity School using its numeric Video ID. The server calls the same `get-file/<video_id>` and `get-video/<video_id>` endpoints used by the original scanner, parses lesson/topic/course metadata, and upserts the result into the persistent course database. Existing IDs are refreshed instead of duplicated.

The Infinity cookie can be configured in either of two ways:

1. Set `INFINITY_COOKIE` as a private Railway variable, or
2. Leave that variable unset and paste a fresh Cookie header into the admin panel. The saved value is encrypted on the private persistent volume with restrictive file permissions and is never exposed by an API response. This is for catalog administration, never viewer playback.

If Infinity expires or rejects the cookie, replace it in the admin panel and retry the Video ID.


## v1.5 — automatic daily Video-ID scan

When `AUTO_SCAN_ENABLED=true` (the default), the server checks whether a scan is due. A scan:

1. Finds the highest Video ID already stored in the persistent course database.
2. Starts at `highest_id + 1`.
3. Fetches IDs in ordered batches using the same Infinity `get-file/{id}` and `get-video/{id}` endpoints as the manual fetch tool.
4. Saves every hit into the persistent `/data/courses.json` database. Any hit resets the consecutive-miss counter to zero.
5. Stops after `AUTO_SCAN_MAX_MISSES` consecutive real empty IDs (default: `1000`).
6. Stores progress/status in `/data/scan-state.json` and runs again after `AUTO_SCAN_INTERVAL_HOURS` (default: `24`). If Railway restarts and a run is overdue, the server catches up after boot.

Authentication redirects, an expired cookie, rate limits, or temporary server/network errors stop the scan as an error instead of being counted toward the 1000 empty-ID limit. The admin panel shows live scan progress and includes **Run scan now** and **Stop scan** controls.

Optional environment variables:

```text
AUTO_SCAN_ENABLED=true
AUTO_SCAN_INTERVAL_HOURS=24
AUTO_SCAN_MAX_MISSES=1000
AUTO_SCAN_BATCH_SIZE=25
AUTO_SCAN_WORKERS=5
```

Keep `STATE_DIR=/data` on Railway and keep the `/data` volume attached so fetched videos, scan progress, labels, codes, and the saved Infinity cookie survive redeploys.

Open search pages check a lightweight course-data version once per minute. After a completed scan (or a manual Video-ID fetch), an already-open search page reloads itself once so the new library appears without a redeploy.

## v1.6 student experience

The student library is grade-aware and defaults to a first-visit grade picker. The current dataset maps the main class sections as:

- Grade 10: `class_section_id = 6`
- Grade 11: `class_section_id = 7`
- Grade 12: `class_section_id = 8` (plus the legacy/alternate Grade 12 section `9`)
- Special/other program sections remain available through **Browse all programs**.

Each grade has a distinct theme, dynamically scoped subjects/teachers, grade-specific stats, quick subject chips, favorites stored in the browser, sorting, responsive filters, and grouped lesson resources. The grade choice is stored in localStorage and can be changed from the header account menu at any time.


## v1.7 browser playback and link recovery

This version adds an in-page player for video resources and a **Refresh video link** action for students. The player uses the browser's **real origin** as the HTTP `Referer` where the browser and CDN allow it. `Referrer-Policy` is now `strict-origin-when-cross-origin` at the page level; the playback preference defaults to `origin` for video and external-link elements. The CSP permits HTTPS media.

Admin → **Video playback & site domain** allows setting:

- **Public website origin**: the expected HTTPS domain, e.g. `https://course-search-production-2aa6.up.railway.app`. This is used to detect when the site was moved; it **does not spoof** the browser's actual `Referer` header. Leave blank to accept the current page origin.
- **Browser referrer policy**: `origin` (recommended), `strict-origin-when-cross-origin`, or `no-referrer`. This controls what browsers are permitted to send, not what the destination CDN must accept.

Both settings are persisted at `STATE_DIR/playback-settings.json`, so changing the Railway domain does not require redeploying. The CDN operator must allow the **actual** site origin; changing these settings cannot bypass CDN allowlists, expired tokens, IP binding, or access controls. Some video formats or cross-origin playback configurations may require the provider's official player.

Students can click **Watch** beside a video resource. If playback fails, the player displays an error and **Refresh video link**. The refresh button:

1. Requires a valid Course Search access-code or admin session.
2. Accepts **only an ID already in the course database**; it cannot enumerate other IDs.
3. Requests a current source with the viewer's own Infinity session, checks authorization, and never changes the shared course record.
4. Updates only the active in-page player. The same still-valid link is acceptable.
5. Enforces per-viewer/IP limits; the old shared per-video cooldown and shared pending-request cache were removed in v1.10.

**No CDN proxy, forged `Referer`, or authorization bypass is implemented.** The Infinity cookie remains on the server and is never returned by the playback settings endpoint.

Run `npm test` to execute the local integration test with a stub upstream service (no requests to the real provider).

## Bunny Stream iframe embeds (v1.8)

In `/admin` under **Bunny Stream embeds**, enter the existing numeric course Video ID and paste an official `https://iframe.mediadelivery.net/embed/<library-id>/<video-guid>` URL, or paste its full iframe HTML. Use **Load existing** to inspect an assignment and **Save embed** to persist it. The app stores the validated URL in `/data/courses.json`; no video files are copied or proxied.

In v1.10, student **Watch** and **Refresh video link** use only a fresh authorized provider response, which may contain a validated Bunny iframe or a supported direct source. Stored admin embeds are never a fallback. Manually assigned metadata embeds are preserved through daily scans. The iframe is removed when the player closes to stop playback.

Only official Bunny Stream iframe URLs are accepted; other hosts and arbitrary HTML are rejected. The CSP permits `frame-src https://iframe.mediadelivery.net` but retains `frame-ancestors 'none'`. The browser sends its actual origin under the chosen referrer policy, so CDN authorization and tokens remain required.

The example iframe in the conversation has Bunny library ID `386` and video GUID `54864774-bc13-417a-862f-70e2a044d030`. Those identifiers do **not** identify the numeric Infinity course Video ID, so the admin must associate it with the correct resource.


## v1.9: Admin-editable playback / Colab guide

- Admin: visit `/admin` → **Playback help & Colab guide**. Edit the title, introduction, step-by-step instructions and optional Python code. Enable or hide the guide and click **Save student guide**.
- Students: open a video → **Playback help & Colab guide**. The collapsible panel displays the latest saved instructions, with **Open Google Colab** and **Copy code** actions.
- Guide content is **plain text** (not HTML) and is never executed in the website. The optional code is intended for use with videos that students are authorized to download.
- Guide is stored at `STATE_DIR/playback-guide.json` on the Railway volume. Existing codes, teacher labels, and video metadata are unchanged.
- Authenticated student access is required to read the guide. Only an authenticated admin can change it. The guide itself needs no additional configuration; v1.10 encryption/production variables above are required.
