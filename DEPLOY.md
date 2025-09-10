Flowshare Deployment

Overview
- Frontend: GitHub Pages (user site) at https://Dheeraj2209.github.io
- Backend APIs: Deploy the same repository to a Node host (Render/Railway/Fly/your server) and run `npm start`.

Environment Variables
- NEXT_PUBLIC_API_BASE_URL: Public URL of your backend API host, e.g. https://flowshare.example.com
- CORS_ORIGIN: Origin allowed to call the APIs, e.g. https://Dheeraj2209.github.io (defaults to *)
- DATA_DIR: Directory on the backend host to store the SQLite DB (optional). If unset, defaults to ./data under the working directory.

GitHub Pages
1) In your repo settings → Pages, set the source to "GitHub Actions".
2) In repo settings → Variables, add `NEXT_PUBLIC_API_BASE_URL` pointing to your backend API base (no trailing slash).
3) Push to `main`. The workflow `.github/workflows/pages.yml` builds a static export (`out/`) and deploys it to Pages.

Backend Hosting (Render/Railway/Other)
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Env vars:
  - `CORS_ORIGIN=https://Dheeraj2209.github.io`
  - For free persistence (recommended): set `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` (Turso/libSQL). No disk required.
  - Or ephemeral local: `DATA_DIR=/tmp/flowshare-data` (data resets on restarts)
- Persistent storage via disk (paid on Render): mount a disk at `/var/data` and set `DATA_DIR=/var/data`.

API-only backend UI
- Set `NEXT_PUBLIC_API_ONLY=1` on the backend service to disable the full UI and show a simple message at `/` pointing to your GitHub Pages site.
- Health check is available at `/api/health`.

Notes
- The app uses Server-Sent Events at `/api/stream`; ensure the backend allows long-running connections and sets `Access-Control-Allow-Origin`.
- This repo is configured for static export (`next.config.ts` sets `output: 'export'`). API routes are served only by the backend host.
- When `LIBSQL_URL` is provided, the backend uses a remote SQLite database (libSQL/Turso) and persists data across restarts.
