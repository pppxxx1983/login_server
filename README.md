# VITA Analytics

Independent role and ranking administration UI backed by the same MySQL database as `http_server`.

## Setup

1. Apply `../http_server/database/schema.sql` to MySQL.
2. Configure MySQL environment variables from `.env.example`.
3. Run `npm run install:all`.
4. Import legacy JSON with `npm --prefix ../http_server run migrate:mysql`.
5. Start API with `npm run dev:server` and UI with `npm run dev:web`.

The API listens on `127.0.0.1:8791` and the UI on `127.0.0.1:5173` by default.

## Deploy without building on the server

The server does not need to run `vite build`. `server/src/main.ts` serves static files from `web/dist`, so the runtime only needs the built files to exist.

GitHub Actions builds the project on every push to `main`/`master` and uploads an artifact named `analytics-build`. Download and extract that artifact on the server, then install production server dependencies and start the API:

```bash
cd analytics/server
npm ci --omit=dev
node dist/main.js
```

The artifact contains:

- `server/dist/`
- `server/config/`
- `server/scripts/`
- `server/package.json`
- `server/package-lock.json`
- `web/dist/`
