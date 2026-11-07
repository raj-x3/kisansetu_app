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
management screens.

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

---

## ✅ Module 20: Staff login made visible + admin creates officer accounts

- Officers, managers and admins log in on the normal **Log in** page. The
  page, the top bar and the home page now say so ("Officer / Admin login").
- Officers **cannot sign up themselves** (anyone could make themselves an
  officer). The **admin** creates them: log in as admin, scroll to
  **Create officer account**, enter name, mobile, role, centre and a
  password, and give those to the officer privately.
- No database change in this module, so no migration is needed.

---

## ✅ Module 21: Case timeline

- **View case timeline** appears on the farmer dashboard, the farmer's
  booking history, and every officer / operator queue row. It lists each
  step in order: what happened, details (token, weight, amount…), when, and
  by whom.
- Farmers see the kind of person who acted ("Gate officer"), not their name.
  Staff at the same centre, and admins, also see the name.
- The server decides who may open a timeline: the farmer who owns the case,
  staff at that centre, or an admin.
- Also fixed: the four Simulation actions now have translated names in the
  audit log.
- No database change, so no migration is needed.

---

## ✅ Module 22: Cancel, change time, and no-show

- **Farmers** (only while the case is still "Slot booked", i.e. before the
  gate officer marks them arrived): **Change time** moves the booking to
  another slot at the same centre, and **Cancel booking** frees the slot.
  The farmer gets a notification and an SMS (if SMS is configured).
- **Gate officer, Operator and Manager**: **Mark no-show** (asks to confirm)
  for farmers who never came, on or after the booking date. The farmer is
  removed from the live queue and told. The slot place is not given back.
- Cancelled and no-show bookings disappear from queues, counts and wait-time
  estimates, and show as "Cancelled" / "No-show" in the farmer's history.
- **Token numbers are now never reused.** The old way (counting bookings)
  could give two farmers the same token once someone cancelled.
- All of it appears in the audit log and the case timeline.
- No database change, so no migration is needed.

Not built: putting a case "on hold", and moving to a different centre
(cancel and book again for that).

---

## ✅ Module 23: QR code token

- **Farmers:** on the dashboard, **Show my QR code** opens a QR code of their
  Case ID. It also appears on the booking confirmation screen. The code holds
  only the Case ID text, nothing personal.
- **Officers and the Operator:** a **Find a case** box (Case ID, token, farmer
  ID or name) and a **Scan QR** button that opens the camera and reads the
  farmer's code.
- No new packages and no database change. The QR generator is written inside
  the project (`frontend/src/utils/qr.ts`), so there is nothing extra to install.
- **Checked here:** the generated codes were drawn and read back by a QR
  reader (all sizes, plus the exact picture a real browser draws).
- **Not checked here:** the camera. Scanning needs Chrome on Android or on a
  computer, and the site must be on `https://` or `localhost`. iPhone Safari
  has no built-in QR reader, so iPhone officers type the Case ID instead. The
  Find box works on every device.

---

## Going online
`DEPLOYMENT.md` was rewritten for the current app: one start command that
creates the tables and demo accounts (`npm run start:render`), both AI models
trained on deploy, a page-refresh rule for the website, tolerant web-address
(CORS) settings, and the real Render free-tier limits. Follow it step by step.

## Crop-wise, weight-based slot capacity

- Every crop has its own kg capacity in every slot (`SlotCapacity`, one row per slot and crop). Wheat bookings only use wheat room, paddy only paddy room.
- Crops are database rows, not code. Admin, Manager and Procurement Officer can add a crop and set its default capacity and largest booking in the **Capacity** panel. No code change is needed.
- Farmer flow: centre → crop → date → weight → the backend ranks only that crop's slots (smallest sufficient remaining room first) → farmer confirms.
- The booking is checked again on the server at confirm time, using one atomic SQL update plus a database CHECK rule, so two farmers cannot take the last kilograms.
- Cancel, no-show and reschedule give the weight back exactly once. A weight change re-checks capacity.
- Capacity can be edited per crop and slot by Admin, Manager and Procurement Officer. Other officers see it read-only. The capacity cannot be set below what is already booked.
- The "Limited" label (less than 25% left) and the largest-booking limit are app settings, not official figures.

## ✅ Module 24: Emergency cancellation and smart rescheduling

A farmer who cannot reach the centre (heavy rain, flooding, a storm warning, a blocked road, another genuine emergency) can send an emergency request instead of a normal cancellation. An officer decides. Nothing is approved or rejected automatically.

**What happens**

1. The farmer opens their booking → **Emergency cancellation** → picks what happened, writes a few words, says when, and may share an approximate place and up to 3 photos/PDFs. Photos are shrunk on the phone and their hidden details (such as GPS) are removed.
2. The server checks the weather in the background (**Under verification**) and then moves the request to **Waiting for an officer**. The booking and its reserved weight stay untouched until a decision.
3. The Document Officer, Manager or Admin of that centre opens the request: sees the farmer's claim, the evidence, the weather check (with its source, time window and reasons), then **Approves**, **Rejects** (remarks required), **Asks for more proof**, or **Flags** it.
4. **Approve** cancels the booking and releases its weight, in one database transaction, to that crop's capacity only. The farmer sees **Choose a new time**.
5. **Reschedule** lists the earliest slots at the same centre that can hold the *whole* weight of the same crop. Confirming reserves the weight atomically and creates a new booking (new Case ID and token). Crop, weight and centre are not typed again.
6. A rejected farmer can ask for **one** second review.

**How the weather check judges (and what it will not do)**

- It looks at the farmer's reported place (if they shared it), a point halfway to the centre, and the centre. If no place was shared, it looks at the centre and four points about 10 km around it.
- A dry centre alone never disproves a claim, and rain nearby never proves one. A claim is marked *Information does not match* only when the farmer's own reported place has data and is dry everywhere checked.
- If the weather service is down or not set up, the result says *Could not be checked*. That is never held against the farmer.
- Weather data cannot prove that one person could not travel. The result is advice for the officer, shown with its reasons.
- Open-Meteo data is **model data**, not weather-station readings, and has no government warnings. WeatherAPI adds official alerts where it has them.
- The rain levels are settings in `.env`, **not official classifications**.

**Where to see it**

- Farmer: dashboard → *Emergency requests* card (status tracker, officer remarks, decision date).
- Document Officer: *Emergency requests* section on the officer dashboard.
- Manager and Admin: *Emergency requests* section on their dashboard.

**Setup**

1. Apply the new tables: `cd backend && npx prisma db push` (this project uses `db push`, it has no migrations folder; `npm run start:render` does it for you online).
2. Optional: set the weather variables listed at the end of `backend/.env.example`. Without any change it uses Open-Meteo, which needs no key.
3. Run the tests (no database, no internet needed): `npm run test:emergency` and `npm run test:weather`.

**Not included (honest limits)**

- Email: the project has no email service, so notifications go in-app and by SMS (only if Fast2SMS is configured).
- The rate limiter lives in server memory (one server). The database still allows only one request per booking.
- WeatherAPI parsing follows its public format but has **not been run against the live service** here. Open-Meteo parsing is tested against its documented format with a stand-in answer, not the live service.
- Nothing has been run end to end in a browser yet. The SQL guards (one request per booking, release once, no overbooking, double-tap safety) were tested on a real PostgreSQL.

### Emergency API

| Method and path | Who | What |
|---|---|---|
| `POST /api/emergency-cancellations` | Farmer | Send a request `{bookingId, category, description, incidentAt, affectedLat?, affectedLng?, evidence?[]}` |
| `GET /api/emergency-cancellations/mine` | Farmer | My requests |
| `GET /api/emergency-cancellations/farmer/:farmerId` | Farmer | Only `me` or my own id |
| `GET /api/emergency-cancellations/:id` | Farmer | One of my requests |
| `POST /api/emergency-cancellations/:id/evidence` | Farmer | Add files while the request is open |
| `GET /api/emergency-cancellations/:id/evidence/:evidenceId/file` | Farmer (own), reviewers (own centre) | Download a file |
| `POST /api/emergency-cancellations/:id/manual-review` | Farmer | Ask for a second review (once, after a rejection) |
| `GET /api/emergency-cancellations/:id/reschedule-options` | Farmer | Earliest slots that fit the whole weight |
| `POST /api/emergency-cancellations/:id/reschedule` | Farmer | Confirm `{slotId}` |
| `GET /api/emergency-cancellations/:id/weather-verification` | Admin, Manager, Document Officer | Weather check history |
| `GET /api/officer/emergency-requests` | Admin, Manager, Document Officer | List; filters `centreId` (admin), `date`, `crop`, `category`, `status`, `flagged` |
| `GET /api/officer/emergency-requests/:id` | same | Detail, evidence, checks, history |
| `PATCH /api/officer/emergency-requests/:id/review` | same | `{action: APPROVE\|REJECT\|REQUEST_EVIDENCE\|FLAG\|UNFLAG, remarks}` |
| `POST /api/officer/emergency-requests/:id/reverify` | same | Run the weather check again |

Staff see only their own centre. A farmer's phone number and address are never sent to officers. Other officer roles get "no permission".

## ✅ Module 25: Live queue, wait-time prediction and automatic waitlist

Two connected features. The farmer sees how long the wait really is. And room that opens up (a cancellation, an approved emergency, a no-show) goes to a waiting farmer automatically.

### Live queue and wait time

- **Farmer dashboard → Live queue.** Shows now serving, farmers ahead, "until your turn starts" and "until you are finished" as **ranges** (for example 20–30 min), a busy level (Low, Moderate, High, Delayed, Temporarily paused), and how busy the other centres are.
- **The maths** (no AI guesswork): the work left for the farmers ahead (each person's remaining steps, using this centre's recent measured step times) divided by the number of active counters. The speed is a rolling average of the last farmers who finished. If fewer than 3 have finished, a labelled **baseline** is used and the farmer is told so.
- **Counters:** the smaller of the centre's configured operators and machines (a counter needs both), or set by an officer for the day.
- **Delay and pause:** an officer can report "running N minutes late" or pause the centre with a reason. Today's farmers are told (in-app, and SMS only if Fast2SMS is set up). Resuming also lets the waitlist continue.
- **Notifications** only for real changes: the wait rose by at least 15 minutes and at least 25%, and not more than once per 20 minutes.
- **Officer congestion view:** current queue, expected arrivals this hour (booked farmers × the share who usually show up), predicted peak, workload, counter use, slowest step, and a look-ahead hour by hour.
- Updates arrive live through Socket.IO. They follow real steps (arrived, verified, quality, weighed), not browser timers.

### Waitlist and slot offers

1. A farmer who finds no slot that fits the **whole** weight taps **Join waitlist** (crop and centre specific, optional time range). Up to 5 active entries.
2. When room opens, the server finds waiting farmers of the **same crop, centre and date** whose **full** weight fits, oldest first (first come, first served). A wheat farmer never gets a paddy offer, and nobody gets a partial slot.
3. The best match gets an **offer**. The weight is held for them for a short time (15 minutes by default; an Admin or Manager can change it). An offer is **not a booking** until the farmer accepts.
4. **Accept** creates the booking atomically (new token and Case ID). **Decline** or **no answer in time** releases the hold and moves to the next farmer. A farmer who misses 3 offers is removed from the list.
5. If nobody fits, the room simply stays in the public booking pool.
6. Officers see the waitlist in offer order, who fits right now, pending offers, and a full **allocation history** with the reason each farmer was skipped. They can **pause automatic offers** (reason required), **offer open room now**, and every manual action is logged with name, time and reason.

Room is released automatically by: normal cancellation, approved emergency cancellation, no-show, a booking moved or made lighter, and a slot capacity increase.

### Safety (what was tested)

All holds use the same guarded SQL as ordinary bookings, so room cannot be given twice. Tested on a real PostgreSQL:

- 12 farmers racing for 4,000 kg with 1,500 kg each → exactly 2 holds granted.
- One offer tapped 8 times at once → exactly 1 winner.
- One expired offer closed by 6 parallel job runs → the weight is returned once.
- Wheat activity never changes paddy numbers. The database refuses a total above capacity.

Plus `npm run test:queue` (21 checks on the maths and look-ahead) and `npm run test:waitlist` (19 checks on matching and ordering). Neither needs a database.

### Setup

1. `cd backend && npx prisma db push` (adds the waitlist, offer, allocation-log and queue-history tables; nothing is deleted).
2. Optional settings are at the end of `backend/.env.example`.
3. **Background job:** `JOB_TICK_SECONDS` (default 30). The server closes timed-out offers on its own timer, so no browser needs to be open. On a free host that **sleeps** when idle (such as Render's free plan), a sleeping server cannot expire offers. It catches up the moment it wakes, but for a live demo keep it awake.

### Honest limits

- The job runs inside the one server process. With several server copies it is still safe (guarded updates), just repeated.
- Wait-time ranges are estimates from this centre's own recent data. Early on they use a labelled baseline.
- Not run end to end in a browser yet. SMS goes out only if Fast2SMS is configured; there is no email service.
- `ml-service` is not used for these estimates. They are plain, explainable calculations.

### Queue and waitlist API

| Method and path | Who | What |
|---|---|---|
| `GET /api/queue/farmer/me` | Farmer | My position, wait ranges, centre level |
| `GET /api/queue/centres` · `GET /api/queue/centres/:centreId` | Signed in | How busy each centre is |
| `GET /api/queue/:centreId/estimate/:tokenNumber` | Staff | Wait estimate for one token |
| `GET /api/queue/:centreId/congestion` · `/predictions` | Staff | Current numbers and hourly look-ahead |
| `PATCH /api/queue/:centreId/status` | Admin, Manager, Operator | `{activeCounters?, delayMinutes?, delayNote?, paused?, pauseReason?}` |
| `POST /api/waitlist` | Farmer | Join `{centreId, cropId, quantityKg, date, windowStart?, windowEnd?}` |
| `GET /api/waitlist/me` · `GET /api/waitlist/:id/offers` | Farmer | My entries, history of offers |
| `DELETE /api/waitlist/:id` | Farmer | Leave the waitlist |
| `POST /api/slot-offers/:id/accept` · `/decline` | Farmer (owner) | Answer an offer |
| `GET /api/officer/waitlist/:centreId` | Admin, Manager, Operator, Procurement Officer | Waitlist, offers, allocation history |
| `POST /api/officer/waitlist/:centreId/redistribute` | same | Offer open room now `{reason}` |
| `POST /api/officer/waitlist/:centreId/pause` | same | `{paused, reason}` |
| `PUT /api/officer/waitlist/:centreId/offer-window` | Admin, Manager | `{minutes}` |

Staff work only on their own centre.
