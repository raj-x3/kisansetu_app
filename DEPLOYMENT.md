# Putting Kisan Procurement Setu Online (Render)

Your app is four pieces, and each must run on the internet:

| Piece | What it is | Render type |
|---|---|---|
| Database | PostgreSQL, stores everything | PostgreSQL |
| Backend | The server and live queue | Web Service |
| AI service | Python wait-time and demand model | Web Service |
| Website | What people open in Chrome | Static Site |

## Read this first: the free-tier limits (checked on Render's own page)

- **The free database expires 30 days after you create it.** After that you
  get 14 days to upgrade before it is deleted. Only one free database is
  allowed per account. Fine for an SIH demo; for anything longer, upgrade it
  or move to another database host later.
- **Free web services go to sleep after 15 minutes without visitors** and take
  about a minute to wake up. Open the site once before a demo to wake it.
- Free web services share **750 hours per month** across your account.
- Free web services have **no shell and no console**. That is why this guide
  makes the backend create its tables and demo accounts by itself each time
  it starts.
- SMS: the free tier blocks the outgoing ports 25, 465 and 587. Fast2SMS uses
  normal web requests (port 443), so SMS still works.

Source: https://render.com/docs/free

---

## Step 1: Put the latest code on GitHub

Do this in the **newest project folder** (the one with `backend`, `frontend`,
`ml-service`). The `.env` file is private and is never uploaded
(`.gitignore` blocks it).

```bash
git init
git add .
git commit -m "Latest version"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main --force
```

`--force` replaces the older copy on GitHub with this one. That is what you
want here. When it asks for a password, paste your GitHub **Personal Access
Token**, not your GitHub password.

Check that the private file did not go up: run `git ls-files | grep env`. It
must show only `backend/.env.example`.

## Step 2: Create a fresh database

If you made a database on Render before, delete it first (it was built for
an older version of the app), then:

1. Render dashboard → **New +** → **PostgreSQL**.
2. Name `agri-procurement-db`, plan **Free**, **Create Database**.
3. When it is ready, copy the **Internal Database URL** from its page.

## Step 3: The backend (Web Service)

Create it (**New +** → **Web Service** → your repo), or open your existing one
→ **Settings** and change these:

- **Root Directory:** `backend`
- **Runtime:** Node
- **Build Command:** `npm install && npx prisma generate`
- **Start Command:** `npm run start:render`
- **Instance type:** Free

This start command creates the tables, adds the demo accounts and centres, and
starts the server, every time. It is safe to repeat.

**Environment** (add each one):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Internal Database URL from Step 2 |
| `JWT_SECRET` | a long random string. Do **not** reuse your local one |
| `JWT_EXPIRES_IN` | `7d` |
| `NODE_VERSION` | `20` |
| `FRONTEND_URL` | `http://localhost:5173` for now (fixed in Step 6) |
| `ML_SERVICE_URL` | `http://localhost:8000` for now (fixed in Step 6) |
| `REQUIRE_DOCUMENTS` | `false` |
| `GEMINI_API_KEY` | optional, your chatbot key |
| `FAST2SMS_API_KEY` | optional, your SMS key |

Do **not** add `NODE_ENV=production`. The start command needs the tools that
are installed in a normal build.

Open the service's **URL** plus `/api/health`. It should show `{"status":"ok"}`.

## Step 4: The AI service (Web Service)

- **Root Directory:** `ml-service`
- **Runtime:** Python 3
- **Build Command:**
  `pip install -r requirements.txt && python app/train.py && python app/demand_train.py`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment:** `PYTHON_VERSION` = `3.11.9` (the pinned libraries do not
  support the newest Python)
- **Instance type:** Free

Both training commands matter: one makes the wait-time model, the other the
demand-forecast model.

## Step 5: The website (Static Site)

**New +** → **Static Site** → your repo:

- **Root Directory:** `frontend`
- **Build Command:** `npm install && npx vite build`
- **Publish Directory:** `dist`
- **Environment:** `VITE_API_URL` = your backend URL + `/api`, for example
  `https://agri-procurement-backend.onrender.com/api`
  (no slash at the end, and it must include `/api`)

Then open the site's **Redirects/Rewrites** tab and add one rule:

- **Source:** `/*`
- **Destination:** `/index.html`
- **Action:** **Rewrite**

Without that rule, refreshing any page except the home page shows "Not Found".

## Step 6: Connect the three addresses

Now every piece has a real address. Go to the **backend** → **Environment**:

- `FRONTEND_URL` = your website address, for example
  `https://agri-procurement-frontend.onrender.com`
- `ML_SERVICE_URL` = your AI service address, for example
  `https://agri-procurement-ml.onrender.com`

Save. Render restarts the backend by itself.

If you ever change the website address, change `FRONTEND_URL` too. A wrong
`FRONTEND_URL` is the most common reason for "Couldn't reach the server" on
the live site. You may put two addresses separated by a comma.

## Step 7: Test the live site

1. Wake things up: open the backend `/api/health`, the AI service
   `/docs`, then the website. The first request after a sleep takes about a
   minute.
2. Register a farmer, book a slot, check the Case ID and QR code.
3. Log in as the demo officers. They are in the README (mobile numbers
   `9000000002` to `9000000008`, password `officer123`).
4. Change the language. Open the chatbot.

## Before real people use it

The demo accounts and their passwords are public (they are in this README).
On a public website, log in as admin (`9000000000`) and create your own
officer accounts from **Create officer account**. Then change the demo
passwords in `backend/prisma/seed.ts` before deploying again. Payments are
tracked as a status only; no real money moves.

## If something breaks

Every Render service has a **Logs** tab, like your terminal at home. Copy
the exact red error from there and send it over.

| You see | Usually means |
|---|---|
| "Couldn't reach the server" on the site | `VITE_API_URL` wrong, or `FRONTEND_URL` wrong or has a typo |
| Refreshing a page shows "Not Found" | the rewrite rule in Step 5 is missing |
| Backend log: `JWT_SECRET is not set` | add `JWT_SECRET` in the backend Environment |
| Backend log: cannot connect to database | `DATABASE_URL` must be the **Internal** URL of the database in the same region |
| No wait-time estimate | the AI service is asleep, or `ML_SERVICE_URL` is wrong |
| AI service build fails on numpy or pandas | add `PYTHON_VERSION` = `3.11.9` |
