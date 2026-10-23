# Deploying Kisan Procurement Setu Online

Your app has **four separate pieces**, and each needs to actually run
somewhere on the internet — not just live in a folder on your laptop:
1. The **frontend** (what people see in Chrome)
2. The **backend** (the API + real-time queue server)
3. The **database** (PostgreSQL)
4. The **ML service** (the Python AI ETA predictor)

We'll host all four on **Render** (render.com) — one free account, one
dashboard, and it supports Node, Python, PostgreSQL, and WebSockets
(needed for the live queue), so you're not juggling four different
services from four different companies.

**Heads-up on the free tier:** Render's free web services "sleep" after
15 minutes of no traffic, and take ~30–60 seconds to wake back up on the
next request. Fine for a demo/SIH judge visit; not fine for 24/7 real
traffic — that would need a small paid plan later.

---

## Step 0 — Put your code on GitHub

Render deploys by pulling your code from a GitHub repository, so this
has to happen first.

1. If you don't have one, create a free account at **github.com**.
2. Install Git if you don't have it: run `git --version` in a terminal —
   if that fails, download it from **git-scm.com**.
3. In your project's root folder (the one containing `backend`,
   `frontend`, `ml-service`), run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
4. On GitHub, click **New repository**, name it (e.g.
   `kisan-procurement-setu`), leave it empty (no README), and create it.
5. GitHub will show you commands like this — run them exactly as shown:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```

Your code (minus `.env`, `node_modules`, and other ignored files — see
`.gitignore`) is now on GitHub.

---

## Step 1 — Create the database on Render

1. Sign up at **render.com** (you can sign up directly with GitHub).
2. Click **New +** → **PostgreSQL**.
3. Give it a name (e.g. `agri-procurement-db`), leave the rest default,
   click **Create Database**.
4. Once it's ready, copy the **Internal Database URL** shown on its
   page — you'll paste this into the backend in Step 2.

---

## Step 2 — Deploy the backend

1. Click **New +** → **Web Service**, connect your GitHub repo.
2. Set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma migrate deploy && npm run seed && npm start`
3. Under **Environment Variables**, add each of these (same names as
   your local `.env`):
   - `DATABASE_URL` → paste the Internal Database URL from Step 1
   - `JWT_SECRET` → any long random string
   - `JWT_EXPIRES_IN` → `7d`
   - `PORT` → `4000` (Render sets its own PORT automatically too — this
     is a fallback your code already handles)
   - `GEMINI_API_KEY` → your key (optional — chatbot just won't work without it)
   - `FAST2SMS_API_KEY` → your key (optional — SMS just won't send without it)
   - `FRONTEND_URL` → leave a placeholder for now (e.g. `http://localhost:5173`)
     — you'll come back and fix this in Step 4
   - `ML_SERVICE_URL` → leave a placeholder for now too — fixed in Step 4
4. Click **Create Web Service**. Wait for it to build and deploy — note
   the URL Render gives it, something like
   `https://agri-procurement-backend.onrender.com`.

---

## Step 3 — Deploy the ML service

1. Click **New +** → **Web Service** again, same repo.
2. Set:
   - **Root Directory:** `ml-service`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt && python app/train.py`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. No environment variables needed here.
4. Deploy, and note this URL too, e.g.
   `https://agri-procurement-ml.onrender.com`.

---

## Step 4 — Deploy the frontend

1. Click **New +** → **Static Site**, same repo.
2. Set:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
3. Add an environment variable:
   - `VITE_API_URL` → your backend URL from Step 2, plus `/api` at the
     end, e.g. `https://agri-procurement-backend.onrender.com/api`
4. Deploy, and note this URL, e.g.
   `https://agri-procurement-frontend.onrender.com`.

---

## Step 5 — Go back and fix the placeholder URLs

Now that everything has a real address:

1. Go back to your **backend** service on Render → **Environment**.
2. Update `FRONTEND_URL` to your real frontend URL from Step 4.
3. Update `ML_SERVICE_URL` to your real ML service URL from Step 3.
4. Save — Render will automatically redeploy the backend with these
   corrected values.

This step exists because of a chicken-and-egg problem: the backend
needs to know the frontend's URL (for CORS) and the ML service's URL,
but those URLs don't exist until after you deploy them.

---

## Step 6 — Test it

Open your frontend URL in Chrome. Register a farmer, book a slot, open
the chatbot — everything should work exactly like it did on localhost,
just live on the internet now. The very first request after a period of
inactivity may take up to a minute (that's the free tier "waking up" —
not a bug).

---

## If something breaks

Every Render service has a **Logs** tab — that's the equivalent of the
terminal windows you've been reading errors from locally. Same rule as
always: copy the exact error text from there and we'll fix it the same
way we've fixed everything else.
