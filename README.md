# Secure Course Search

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
- 3,956 meaningful course/video rows indexed from the supplied CSV
- Search, filters, grid/list layouts, and course details
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
- `COOKIE_SECURE` — set `true` behind HTTPS. Secure cookies are also enabled automatically when `NODE_ENV=production`.

## Deployment

This is intentionally **not** a GitHub Pages/static-only project. Static hosting cannot keep the course data or access-code logic private.

Deploy it to a Node.js host with a **persistent filesystem/volume**. `data/access-codes.json` changes whenever a code is created, used, revoked, or deleted, so it must survive application restarts/redeploys.

Recommended deployment shape:

1. Put the project in a private Git repository. `.env` is ignored by Git.
2. Set `ADMIN_PASSWORD` and `SESSION_SECRET` as private environment variables on the host.
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

That rebuilds `data/courses.json`. Restart the server afterward.

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
```

Use `npm start` as the start command and `/health` as the healthcheck path.
