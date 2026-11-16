# LANTAW — System Demonstration Script

> **Format:** Narrated, single presenter, **~13 minutes** (fits a 10–15 min slot).
> **Narration** is the *normal text* — say it nearly as written; it is written to be spoken (~140 wpm).
> **Action cues** are the `code-style` lines — do them while talking.
> **[OPTION B]** blocks are skippable add-ons if you are *ahead* of the clock.
> **IF BREAKS** tells you what to say/do when the demo misbehaves. Never apologize more than once.

**Timing checkpoints** — at these marks you should be at these scenes:

| Clock | You should be… |
|---|---|
| 0:45 | Finishing the opening, typing the admin email |
| 4:15 | Logging out of admin → signing in as manager |
| 7:45 | Logging out of manager → signing in as faculty |
| 9:00 | Course Learning Outcomes (the AI moment) |
| 11:15 | Generate Map (faculty) |
| 13:00 | Closing slide / Q&A |

**Sign-ins used (from README §3.1):**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cqi.test` | `Admin@123456` |
| Manager | `manager@cqi.test` | `Manager@123456` |
| Faculty | `user@cqi.test` | `User@123456` |

---

## Pre-demo checklist (do this BEFORE the panel enters)

1. `npm run dev` — server warm at `http://localhost:5173`; open the tab, refresh once.
2. Dry-run all three logins once (this also confirms seed data survived and *pre-caches the AI model* — see step 3).
3. **Pre-load the PO-suggestion model:** sign in as `user@cqi.test`, open **Course Learning Outcomes**, and wait on that page until the strip stops saying "Enhancing accuracy — loading AI model… %". The ~110 MB `all-mpnet-base-v2` weights then live in the browser cache, so during the live demo the suggestions are instant instead of a 20-second download.
4. Sign everything back **out** — the demo must start at the Login page.
5. Browser window: 100–110% zoom, bookmarks bar hidden, notifications off.
6. Have the seed data visible on your phone as backup (programs BSIT/BSCS, 5 courses, PO1–PO8, CLO1–CLO9) so you can notice instantly if something was wiped.
7. Second browser tab open to the Generate Map page as a warm fallback.

---

## 0 · Opening hook — 0:00 → 0:45

*(Slide with the problem statement behind you. Do not touch the laptop yet.)*

> Good day, panel. Before I open the system, one problem to keep in mind: in curriculum work, nothing lives in one place. Program outcomes sit in CHED memoranda, course outcomes sit in syllabi files, and the Table of Specifications is built by hand in Excel — so when a program head asks *"which Course Learning Outcomes actually feed which Program Outcomes?"*, the honest answer is a folder of scattered documents.

> **LANTAW** answers that with one data-driven system: curriculum mapping and outcomes alignment, built on React and Supabase, with three roles — Administrator, Program Head, and Faculty — and every permission enforced twice: in the interface, *and* in the database itself.

> Let me show you what that means, walking the same route its three real users take: the admin who runs it, the program head who maintains the alignment, and the faculty member who writes outcomes and builds exams.

`Open the app — you should be at the Login page (dark-green "Welcome Back!" card on the NBSC circuit artwork).`

> One detail before I sign in: notice there is no "create an account" option. In LANTAW, accounts exist only because an administrator put them there — closed registration is a design decision, not an oversight. *(Type `admin@cqi.test` / `Admin@123456` and click Login.)*

**IF BREAKS — login fails:** one retry, then: *"The demo accounts are seeded in the database; if the panel permits I'll reset the local schema" — and use the SQL from README §3.1. Don't debug on stage.*

---

## 1 · Admin — the system administrator — 0:45 → 4:15

### 1.1 Dashboard ($\approx$ 45 s)

*(Landing on the admin Dashboard: banner strip with campus-entrance artwork, stat tiles, quick actions.)*

> Signed in as the Administrator — the ICT Officer's assistant, effectively. The dashboard opens with live counts: users, Strategic Goals, PEOs, Program Outcomes, Course Learning Outcomes, CHED Memorandum Orders — every tile is a **live query**, not a hardcoded number.

`Sweep the cursor across the stat tiles, then to the quick actions row.`

> The quick actions mirror the admin's real duties; the bottom strip says **Recent activity** — the same audit trail I'll show in a moment.

### 1.2 Users & Accounts ($\approx$ 70 s)

`Sidebar → Users & Accounts.`

> The user table. Each row carries its role as a badge — and these roles aren't labels, they're database enums that drive **Row Level Security**.

`Click Add-user / Create user. Show the role select (admin / manager / faculty). Point, don't submit — or create a throwaway faculty account if you're comfortable.`

> Creating an account here means the person can *never* self-register a mystery account — Google sign-in only works for addresses the admin or manager already registered. *(Close the modal if you didn't create one.)*

`Open the Edit modal on an existing row (read-only identity strip + role & program selectors), then close it.`

> Editing respects the same principle — the identity strip is read-only; what changes is the role and program assignment.

**IF BREAKS — "Create user" errors:** the admin create feature needs the service-role key in `.env`. Say: *"That toggle depends on a server key I've deliberately kept out of the demo build for security — the rest of the demo doesn't depend on it,"* and move to Activity Logs. That's literally a security talking point, not a failure.

### 1.3 Activity Logs — the audit trail ($\approx$ 60 s)

`Sidebar → Activity Logs. Search something recent (type "login" in the action filter).`

> Every sensitive action lands here: who did it, what action, when — and the *context* line under each badge: which record was touched. Sign-in attempts are logged too, including **failed ones with the reason** — highlighted in red.

> Two details worth tasting: the actor's email is **stamped by the server from their login token** — a client can't forge an entry blaming another user — and the record's label is snapshotted at write time, so renaming a record later never rewrites history.

`[OPTION B — if ahead of the clock (30 s):]` `Sidebar → Academics → Strategic Goals → create one quickly, then show that Delete only appears on the archived tab.`
> Quick CRUD — and note Delete *only* exists on archived records; nothing is destroyed in one click by accident.

`Click the avatar (top-right) → Logout.`

> That's oversight. Now the second actor: the Program Head.

---

## 2 · Manager — the program head / CQI lead — 4:15 → 7:45

### 2.1 Same system, different system ($\approx$ 40 s)

`Sign in: manager@cqi.test / Manager@123456.`

> Same person? No — same *system*, different chair. Watch the navigation: the Program Head sees a different menu than the admin did.

`Land on the manager Dashboard: stat tiles for Curriculum, Programs, Courses, POs, CLOs, Faculty.`

> Their dashboard answers *their* question — how much curriculum exists and how much of it is mapped. No user administration, no account creation — those belong to the admin.

### 2.2 Curriculum — manage, but never delete ($\approx$ 60 s)

`Sidebar → Academics → Curriculum. Search a record, open Active/Archive tabs.`

> The Program Head creates, edits, and **archives** curriculum records — but look at the card actions: there is no Delete. Deletion is admin-only. Why? Because curriculum records are the spine of the alignment matrix — one mis-click by a program head shouldn't ripple through every report.

`Create or edit one record quickly (title + description), save.`

> Everything typed here flows straight into the mapping pages the faculty will see — same data, same server, different write permissions per role.

### 2.3 Program Outcomes — anchored to CHED ($\approx$ 50 s)

`Sidebar → Academics → Program Outcomes.`

> These aren't freely-invented rows: the official list comes from **CHED Memorandum Order 25, s. 2015** — PO-1 through PO-4 plus the sixteen SD outcomes. The manager can maintain it, and every downstream page — the mapping matrix, the reports, the coverage charts — reads *this* list live.

`[OPTION B — if ahead (30 s):]` `Sidebar → Academics → Course — highlight that the manager's Course page has create/edit/archive but, again, no Delete (the admin's Course page does).`

### 2.4 Users directory — almost read-only ($\approx$ 35 s)

`Sidebar → Users & Accounts.`

> The Program Head sees the directory — governance work needs context — but can only add or remove **faculty** accounts. Managers can't create managers, can't touch admins, can't change anyone's role. The permission matrix is enforced by the database, not by us remembering to hide buttons.

`Click the avatar (top-right) → Logout.`

> Third chair: the person who actually writes outcomes and builds exams.

---

## 3 · Faculty — the instructor — 7:45 → 11:15

### 3.1 A dashboard that manages your day ($\approx$ 50 s)

`Sign in: user@cqi.test / User@123456.`

> The faculty home opens with a **next-step card** — the system reads their subjects and tells them which one still needs outcomes written: "Start with…", "Next up…", or "Every subject is covered."

`Point at the four personal figures, then "Your subjects", then scroll to "Program at a glance".`

> Personal figures: outcomes written, subjects covered, edits in the last 7 days. Notice the scope — these numbers are **this instructor's own**; the database policy scopes faculty queries to their own rows. And the map preview at the bottom is the full year—by—semester curriculum *on the dashboard itself*.

### 3.2 Course Learning Outcomes — with the alignment engine ($\approx$ 80 s) ✦ signature moment

`Sidebar → Course Learning Outcomes. Pick a course (e.g., an IT subject). Click to draft a new CLO (or edit an existing draft) — e.g. type "Apply algorithmic thinking to solve data structure problems".`

> Here's the part I'm proudest of. A faculty member writes a Course Learning Outcome in plain English — and LANTAW suggests the closest Program Outcome it aligns with, ranked and scored.

> Under the hood it's a hybrid ranking: keyword matching with a curriculum-tuned synonym lexicon (about 40 CHED phrase families), fused with **semantic similarity from an AI language model that runs entirely in the browser** — no API call, no data leaves this machine. It even re-ranks finalists per field before it settles.

`Point out the suggestion strip (top percentage + alternates). Hover for the tooltip. Pick the suggested PO and save the CLO.`

> We pinned this against a 61-case test fixture on the official CHED list: **top-1 accuracy 100%, top-3 100%** at last measurement, and those exact ceilings are guarded by automated tests — future edits can't silently regress it. The model preloaded earlier, so this was instant; even without it, a keyword fallback keeps the strip alive — the page never goes blank.

**IF BREAKS — strip still says "loading AI model… %":** keep talking, then: *"On this machine the heavyweight AI layer is still downloading, so LANTAW transparently fell back to its keyword layer — same suggestions, slightly less semantic nuance. The strip updates the moment the model finishes."* Then demo with whatever the strip shows.

### 3.3 Generate TOS — the exam blueprint ($\approx$ 75 s)

`Sidebar → Generate TOS. Open an existing blueprint (or create one): the spreadsheet-style grid with green cells and gray totals.`

> The Table of Specifications — the bane of every instructor's exam week — as a live spreadsheet: type topics and hour weights in the green cells, and the items/points column, the header percentages, and the column totals **recompute as you type** — Bloom's six cognitive levels included.

> Every keystroke autosaves on a short debounce; Save-pending flushes now, Discard re-reads the server. The blueprint library on the side manages the full lifecycle — edit, open, archive, restore — and Delete cascades the papers and rows in one move, logged as `tos_exam.deleted`.

`Click Export (the workbook export).`

> Export produces the real workbook — letterhead, green editable cells, gray formula cells with **live `=SUM` formulas** that Excel recomputes on open.

### 3.4 Generate Map — the subject graph ($\approx$ 70 s)

`Sidebar → Academics → Generate Map (faculty's copy). Press View → the d3 graph renders.`

> Finally, the map itself — the system's nameplate feature. Every node is real database data: subjects linked to their curriculum, prerequisites, Course Learning Outcomes, Program Outcomes, PEOs, Strategic Goals, CHED orders. Green monochrome for calm; the single **amber** line type is reserved for prerequisites — like "third-year standing" gates, which LANTAW expands into their real band of prerequisite subjects.

`Press and hold a subject dot — the spotlight lights its forward prerequisite chain. Press again (or the empty canvas) to clear.`

> Press any subject and LANTAW walks its *forward* prerequisite chain end-to-end — press a first-year subject and watch its influence reach the capstone.

> ...and the map is **live**: it subscribes to database changes — if the manager edits an outcome right now, this canvas updates without me refreshing. *(Say it; don't force it live unless genuinely easy.)*

`[OPTION B — if ahead (30 s): open the legend/About on a node and show the Unresolved badge count.]`

`Click the avatar (top-right) → Logout.`

---

## 4 · Security close + landing — 11:15 → 13:00

*(Back on the Login page. This is where the argument lands.)*

> I showed you three chairs today. The reason that demo *worked* is that every difference you saw was enforced **in the database**, not just in the menus. Supabase Row Level Security policies gate every table: a faculty member querying another user's data directly — bypassing our interface entirely — gets refused by the database itself.

> Three concrete guarantees: **one** — role-scoped reads: faculty counts and subjects are their own; managers/admins see the system. **Two** — the audit trail's actor is server-stamped from the login token, so entries can't be forged against a colleague — and we document its honest limits: activity log, not a tamper-proof record. **Three** — sign-in is closed: no self-registration, only school accounts an admin or manager first registered. And the whole service layer stands behind **342 automated unit tests**.

> So, to close the loop with the opening: LANTAW replaces the folder of scattered documents with one system where the alignment question — *"which CLOs feed which POs?"* — is answered by the **data itself**, at every level from a single course outcome to the whole program's coverage chart. *(Advances to closing slide.)* Thank you — may I open for questions?

---

## Contingency quick-reference

| Symptom | Say / do |
|---|---|
| Login rejected on a demo account | One retry; if rate-limited by auth, wait it out or use another role; *"(give me one second — auth throttling)"* |
| "Create user" errors (admin) | Skip creating; demo the Edit modal instead — say the server key is excluded from the demo build *for security* |
| AI strip stuck on "loading model… %" | Keyword fallback is automatic; narrate the two-layer design — the page never blanks |
| Map blank after pressing View | It renders after data loads; talk about the hierarchy while it resolves — if the tab is stuck, switch to the pre-warmed backup tab |
| Realtime edit not visible | Say the canvas also re-syncs on focus and on a 45-second poll — click another tab and back |
| Schema looks wiped / counts are 0 | Re-run the role UPDATEs + seed statements from README §3.1 between sessions — do **not** re-run the DROP-based schema on stage |
| Running >1 min ahead | Use the `[OPTION B]` blocks in that scene |
| Running >1 min behind | Skip 2.3 (Program Outcomes) *or* 3.4's spotlight press — but **never** skip 3.2 (the AI moment) or the security close |

## Likely panel questions — one-breathe answers

- **"Why is RLS better than just hiding menu items?"** — Hiding is cosmetic; RLS is the database refusing the query regardless of *how* it's sent. We treat the browser as untrusted.
- **"Why run the AI model in the browser?"** — Free, offline-capable, no API keys, no faculty data leaves the device; it caches after first load.
- **"How do you measure suggestion accuracy?"** — A 61-case fixture over the official CHED 25-s.-2015 list (exact drafts, paraphrases, faculty-style wording): measured top-1 100% / top-3 100%, guarded in tests so edits can't silently regress.
- **"Who can delete what?"** — Deletes are admin-only (curriculum, courses, outcomes, TOS are per-owner for TOS blueprints); managers edit and archive. Audit-trail entries log every archive vs. delete distinctly.
- **"Is the activity log tamper-proof?"** — Honestly: no — it's tamper-*evident* (server-stamped actor), and we document the remaining gaps: clients pick their own action strings and the login-event RPC accepts unauthenticated calls. Closing both means server-side writes — our documented next step.
- **"Why no self-service password reset on the login page?"** — Accounts exist only by administrator registration, so recovery is administrator-initiated too — a deliberate policy choice, with the full reset journey (set-new-password + expired-link screens) still built for the links admins send.
- **"What happens to a manager's wrong click?"** — Archives are reversible; deletes are restricted and confirmed; the audit log records who, what, and which record.

---

*Source of truth: `README.md` (roles/RLS/audit), `src/App.tsx` (per-role navigation), `src/components/Sidebar.tsx` (Academics dropdown, Logout menu). Update this file whenever a nav label or feature name changes.*
