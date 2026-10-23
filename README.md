# Smart Agricultural Procurement Platform — Build Log

This project is being built module by module. This README always reflects
**what currently exists and how to run it.**

## ✅ Module 1: Database schema + Authentication
## ✅ Module 2: Frontend — Landing, Registration, Login, Farmer Dashboard
## ✅ Module 3: Procurement Centres + Capacity-Aware Slot Booking
## ✅ Module 4: Live Queue (real-time, via Socket.IO)
## ✅ Module 5: Multi-language UI + AI chatbot with voice (Gemini)
## ✅ Module 6: AI ETA Prediction (real Python ML service)
## ✅ Module 7: Voice fixes + fuller translations + real SMS + crowd-aware queue
## ✅ Module 8: The full Operator dashboard
## ✅ Module 9: Quality Check
## ✅ Module 10: Weighing
## ✅ Module 11: Procurement Completion
## ✅ Module 12: Payment Tracking
## ✅ Module 13: Admin Dashboard
## ✅ Module 14: Notifications + Audit Logs
## ✅ Module 15: Demand Forecasting + Bottleneck Insights
## ✅ Module 16: Simulation Mode
## ✅ Module 17: Booking history + rebooking fix, and analytics filters
## ✅ Module 18: Officer roles, Manager view, and Case IDs
## ✅ Module 19: Document upload and review (and a fully translated landing page)

**All 16 planned modules are built, plus the two small gaps identified
afterward are now closed too.**

## Module 17 — what was actually fixed

### 1. The real bug behind "a finished booking stays current forever"
`Booking.status` was **never once set to `COMPLETED`** anywhere in the
codebase — procurement completion only ever updated `Procurement.status`
and `QueueEntry.stage`, leaving the booking itself stuck at `"BOOKED"`
permanently. That's the actual root cause of the gap flagged earlier.

Fixing it safely required auditing **every single query in the backend**
that filtered on `status: "BOOKED"` (15 call sites, all traced and
categorized by hand, not assumed) — because some of them *should* now
correctly exclude a finished booking (queue position, "farmers ahead",
call-next candidates), while others *must keep including it* or they'd
silently break (today's token numbering — a real collision risk once
bookings could complete and drop out of the count mid-day — the
operator's queue table, which is designed to still show completed rows,
and five different "today's volume" stats on the Admin dashboard and ML
features, which should reflect the whole day, not just who's still
active). All 8 call sites that needed broadening now use
`status: { not: "CANCELLED" }` instead of a hard filter to `"BOOKED"`,
each with a comment explaining why.

What this unlocks:
- A farmer can now book again after finishing a previous booking the
  same day (the duplicate-booking check only ever blocked a second
  *active* booking — that was already correct, it just never got the
  chance to matter before).
- **New: Booking History** (`/farmer/history`, linked from the
  dashboard) — every past booking with its final outcome: quality
  result, net weight, amount, bill reference, payment status.

### 2. Analytics filters (date range, centre, crop, district)
Added to `GET /api/admin/analytics` as entirely optional query
parameters — a new filter bar at the top of the Admin dashboard, with
Apply/Clear. Left completely unfiltered (zero query params), the
dashboard behaves **exactly as before**, byte-for-byte — this was a
deliberate design choice to avoid any regression risk to the default view.

One honest implementation note: I can't run this against a real
database in this sandbox, so rather than hand-building four differently
-shaped nested `where` clauses (one each for Booking, Procurement,
Payment, QueueEntry — real risk of a silently-wrong filter merge when
combining multiple dimensions), the backend resolves **one list of
matching Booking IDs first** against the model with the most direct
relation paths, then scopes every other query with a simple
`bookingId: { in: [...] }`. Lower risk, easier to verify by reading.

A few filter semantics worth knowing: "Farmers Waiting" is deliberately
**never** filtered (it's a live, right-now number, not a historical
report figure). "Active Centres" stays global. A district filter also
narrows the "Registered Farmers" count directly, since that one has an
obvious, direct meaning.

### Verification performed on this module
Every one of the 15 `status: "BOOKED"` call sites was traced to its
exact surrounding code and categorized before any edit was made — not
assumed from memory. All schema relation paths used in the new filter
logic (`Procurement.bookingId`, `Payment.procurementId`,
`QueueEntry.bookingId`, `Farmer.district`) were re-confirmed directly
against `schema.prisma` immediately before writing the code that
depends on them. Every changed file passed a TypeScript syntax check.
Every translation key referenced in the two changed/new frontend pages
was checked against the dictionary — both the ones called directly and
the ones looked up indirectly through the `STAGE_KEY`/`PAYMENT_KEY`
maps, which a plain text search would have missed. All 226 translation
keys confirmed present in all six languages by the compiler. The exact
query-parameter names the frontend sends were checked character-for-
character against what the backend reads off `req.query`. As always:
this is static verification, not a runtime guarantee, since I can't
install packages or run the app in this sandbox — paste the exact error
if something still doesn't compile once it runs for real.

### Not built yet — the big one
The fuller 9-role officer system from your original architecture
document (separate Gate/Document/Quality/Weight/Procurement/Payment
officer logins instead of one shared Operator, plus a formal Case ID).
This is next, and it's a genuinely large undertaking — see the
follow-up message for the honest scope and plan before I start it.

---

## How to run everything (Modules 1–19)

⚠️ **First time after Modules 18–19 you must update the database** (see the
Module 18 and 19 sections). In `backend`, run
`npx prisma migrate dev --name add_officer_roles_case_id_documents` and then
`npm run seed`. Say yes if Prisma offers to reset the demo database.

```bash
# Terminal 1 (backend)
cd backend && npm install && npm run dev

# Terminal 2 (frontend)
cd frontend && npm install && npm run dev

# Terminal 3 (AI wait-time service)
cd ml-service && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
```

Open the address the frontend terminal prints (usually http://localhost:5173).

### Try it
1. Take a booking all the way to **Complete Procurement** and **Payment
   Credited**.
2. Go back to the farmer's dashboard — it should now say "None yet /
   Book a Slot" again, instead of showing the finished booking forever.
3. Click **View Booking History** — the finished booking should appear
   there with its full outcome.
4. Book a new slot the same day — it should work now (previously this
   would have been wrongly blocked).
5. Log in as admin, try the new filter bar — pick a date range or a
   crop, click Apply, and confirm the summary cards and charts narrow
   accordingly. Click Clear to confirm it goes back to the original
   all-time view exactly.

### If something doesn't work
Same as always — paste the exact red error text and we'll fix it the
same way we've fixed everything else so far.

---

---

## ✅ Module 18: Officer roles, Manager view, and Case IDs

### What's new
- **7 new logins** besides Farmer/Admin: Manager, Gate, Document, Quality,
  Weight, Procurement and Payment officers. Each can do **only its own step**.
  The server enforces this (a Gate officer calling the weighing URL gets
  "You don't have permission"), not just the screen.
- **Case ID** (like `CASE-2026-000047`) for every booking. Farmers see it on
  the booking confirmation, dashboard and history. Officers see it in tables
  and can search by it.
- **Manager dashboard**: analytics, Call Next Farmer, and a live Pipeline
  board (tap a stage to see its cases). No Simulation or Add Centre.
- The old all-in-one **Operator** login (9000000001) still works.
- The audit log now records the real name of every officer.

### Demo logins (development only)
| Role | Mobile | Password | Opens |
|---|---|---|---|
| Admin | 9000000000 | admin123 | /admin/dashboard |
| Operator (all steps) | 9000000001 | operator123 | /operator/queue |
| Manager | 9000000002 | officer123 | /manager/dashboard |
| Gate officer | 9000000003 | officer123 | /officer/dashboard |
| Document officer | 9000000004 | officer123 | /officer/dashboard |
| Quality officer | 9000000005 | officer123 | /officer/dashboard |
| Weight officer | 9000000006 | officer123 | /officer/dashboard |
| Procurement officer | 9000000007 | officer123 | /officer/dashboard |
| Payment officer | 9000000008 | officer123 | /officer/dashboard |

### ⚠️ You MUST update the database (new roles + Case ID)
```
cd backend
npm install
npx prisma migrate dev --name add_officer_roles_case_id_documents
npm run seed
```
Existing bookings have no Case ID, so Prisma will probably say it needs to
**reset the database**. Say yes (it's demo data), then run `npm run seed`.
**If you copy these files over an old folder, keep your own
`backend/prisma/migrations` folder.** Commit the new migration to GitHub
before redeploying on Render.

### Try it
1. Register a farmer and book a slot. Note the Case ID.
2. Log in as the Gate officer, mark the farmer arrived. Try to do anything
   else — there is no button, and the server would refuse anyway.
3. Log in as each officer in turn (Document, Quality, Weight, Procurement,
   Payment) and do their step. The farmer's dashboard updates live.
4. Log in as the Manager and watch the Pipeline board.

### Not built yet (honest list)
Hold / reschedule states, per-role URLs (all officers share
/officer/dashboard), a case timeline page, admin user and price
management screens, and QR codes.

### Checks I could run
No `npm install` is possible in my workspace, so I only checked syntax,
imports, field names and translation keys. If you see a red compile error,
paste it here.

---

## ✅ Module 19: Document upload and review

### What's new
- **Farmers** get a "Your documents" card on the dashboard. Pick a type
  (identity proof, land record, other), choose a PDF/JPG/PNG up to 2 MB and
  upload. Each file shows **Waiting for review / Verified / Rejected /
  Correction needed**, with the officer's reason.
- **Document officer** (and the old Operator login) sees a **Review documents**
  link on each arrived farmer. They can open the file, then **Verify**,
  **Reject** or **Ask for correction**. Reject and correction need a short
  reason. The farmer gets a notification, in their own language.
- The server checks the real file type from the file's contents (not its
  name), the size, who owns the booking, and that the officer is at the
  same centre. Files are stored in the database, never in a public folder.
- Uploads and reviews appear in the audit log.
- **Optional rule:** in `backend/.env` set `REQUIRE_DOCUMENTS="true"` and
  "Mark verified" will refuse until the identity proof is Verified. It is
  **off by default** so the demo and Simulation Mode keep working.
- The landing page and the flowchart were already translated. I also
  translated the last few English-only messages (loading text, "no slots
  found", the language picker's label).

### Database update
This adds a `documents` table. Use the same migration command as Module 18
(the name above covers both). If you already ran the Module 18 migration,
run `npx prisma migrate dev --name add_documents` instead.

### Try it
1. As a farmer with a booking, upload an identity proof from the dashboard.
2. Log in as the Gate officer (9000000003), mark the farmer arrived.
3. Log in as the Document officer (9000000004), click **Review documents**
   and verify or reject it. Then check the farmer's dashboard and the bell.
4. Optional: set `REQUIRE_DOCUMENTS="true"`, restart the backend, and try
   **Mark verified** before the document is verified.

### Honest limits
Files up to 2 MB are stored in the database, which is fine for a prototype
but not for large scale. There is no virus scanning. A farmer can't upload a
second file of a type that is already waiting or verified.
