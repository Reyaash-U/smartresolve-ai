# Deployment guide (free tier, ₹0)

Order matters because each step needs the previous step's URL: **Atlas → Render → Cloudflare Pages → back to Render (CORS)**.

## 1. MongoDB Atlas (database)

1. Create a free **M0** cluster.
2. **Database Access** → add a database user (alphanumeric password), role *Read and write to any database*.
3. **Network Access** → allow `0.0.0.0/0` (Render's free tier has no fixed IP; see [SECURITY.md](SECURITY.md)).
4. **Connect → Drivers → Node.js**, copy the string and add the database name:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/smartresolve?retryWrites=true&w=majority`
5. Seed from your computer (never from a public route): put the string in `server/.env`, then `cd server && npm run seed:reset`.

## 2. Render (API)

1. Push this repository to GitHub (public).
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`), plan **Free**.
   *(Or New → Web Service: root directory `server`, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/health`.)*
3. Set environment variables: `MONGODB_URI` (the Atlas string), `CLIENT_ORIGIN` (fill in after step 3; for now `http://localhost:5173`). `JWT_SECRET` is generated for you.
4. Deploy, then open `https://<your-service>.onrender.com/health` — expect `{"status":"ok","db":"connected",...}`.

## 3. Cloudflare Pages (frontend)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → same repo.
2. Framework preset *None*; **Root directory** `client`; **Build command** `npm run build`; **Output directory** `dist`.
3. Environment variables: `VITE_API_URL` = your Render URL (no trailing slash), `NODE_VERSION` = `22`.
4. If the form shows a **Deploy command** (Workers flow), use `npx wrangler deploy`. `client/wrangler.jsonc` serves `dist` and makes deep links work (single-page-app fallback). Do **not** add a `_redirects` catch-all (`/* /index.html 200`): the Workers flow rejects it as an infinite loop. (On the older Pages-only flow there is no deploy command and a `_redirects` file is the way to get the fallback.)

## 4. Close the loop

Back in Render, set `CLIENT_ORIGIN` to your Pages URL (e.g. `https://smartresolve.pages.dev`, no trailing slash; comma-separate several if needed) and redeploy. Without this the browser blocks API calls (CORS).

## 5. Verify

- `/health` returns ok; the app loads; sign in as `reporter.a@example.test`.
- Run the 10-step reviewer script from the brief on the **live** URLs and fill in TC-35 in [TEST-MATRIX.md](TEST-MATRIX.md).

## Free-tier behaviour to expect

- Render sleeps after ~15 minutes idle and takes about a minute to wake; the UI shows a waiting message and retries. Open the app once before a demo.
- Render's disk is ephemeral: nothing persistent is stored there (all data is in Atlas).
- Atlas M0 has ~0.5 GB; this demo uses a few MB.
- Before presenting, run `npm run seed:reset` so the seeded overdue/aged tickets are fresh.

## CI

`.github/workflows/ci.yml` runs on every push/PR: server typecheck, build, tests (in-memory MongoDB, no secrets), classifier evaluation, and client typecheck + build.
