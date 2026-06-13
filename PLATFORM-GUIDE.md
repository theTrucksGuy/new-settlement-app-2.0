# Daman Mandeep Roadlines — Driver Settlement Platform Guide

**Last updated: 2026-06-13**

## What this platform is

The DMR (Daman Mandeep Roadlines) Driver Settlement Engine is a web application that the back-office team uses to calculate and record what each truck driver should be paid for a given settlement period. A staff member connects the company's master spreadsheet (trips, cash/UPI/bank advances, driver details, vehicles, diesel, attendance), selects one driver and a date range, and the app automatically pulls that driver's trips and advances. The user answers a few questions per trip (rate, halt days, expenses to reimburse), adds any bonus or penalty, and the app computes the **Net Payable**. The finished settlement is saved to the cloud, can be reviewed, approved, and marked as paid by higher-permission staff, and produces a printable PDF statement for the driver. The whole tool is one HTML file backed by Firebase — there is no separate application server.

### Contents

1. **Who uses it & what they can do** — the three roles and what each can do.
2. **Where the data comes from** — the master workbook and the two ways to connect it.
3. **The settlement workflow, end to end** — the step-by-step wizard for settling one driver.
4. **How pay is calculated** — the per-trip and Net Payable formulas.
5. **Advances & the locking / carry-over system** — how money already paid is recovered exactly once.
6. **Diesel & attendance** — how fuel evidence is matched to the right driver.
7. **Settlement Coverage** — the roster-wide "who's been settled, where are the gaps" dashboard.
8. **Records, lifecycle, editing & outputs** — reviewing, approving, paying, and exporting.
9. **Architecture & data model** — *(technical — skip if non-technical)*.
10. **Operations** — deploying, provisioning users, caching.
11. **Glossary** — plain-language definitions of the key terms.

---

## 1. Who uses it & what they can do

Everyone signs in with an email and password. There is **no self-service signup** — accounts are created by an administrator using a provisioning script (see Operations). Every user is assigned one of three roles, and the same permissions are enforced in two places: the app hides buttons you can't use, and the cloud database itself refuses actions you're not allowed to do, so the rules can't be bypassed by tampering with the browser.

| Capability | Basic | Manager | Admin |
|---|:---:|:---:|:---:|
| Sign in & read all settlements | Yes | Yes | Yes |
| Create / submit a new settlement (run the wizard) | Yes | Yes | Yes |
| Add / update saved routes | Yes | Yes | Yes |
| View Coverage screen (read-only) | Yes | Yes | Yes |
| Edit a saved settlement record | — | Yes | Yes |
| Mark a settlement **Verified** | — | Yes | Yes |
| **Finalise & Pay** a settlement | — | — | Yes |
| Delete a settlement | — | — | Yes |
| Edit existing saved route rates (in the UI) | — | — | Yes |
| Record manual "settled outside software" ranges + bulk-settle | — | — | Yes |

The roles form a hierarchy: **admin ⊇ manager ⊇ basic**. An admin can do everything a manager can, and a manager can do everything a basic user can.

> **A note on routes:** The app hides the route-rate edit buttons from non-admins, but the underlying database does not block a determined, signed-in staff member from changing route rates. In practice this is fine because only your own trusted staff have logins — just be aware route rates are a trusted-staff setting, not a locked-down admin-only one.

A signed-in user sees their name and role in the top-right corner (e.g. *"Manager 1 (manager)"*) with a **Sign out** button.

---

## 2. Where the data comes from

All settlement inputs come from the company's master workbook, the **"PROFIT & LOSS DASHBOARD"** Google Sheets file. The app reads the same set of logical tabs no matter how the data is connected:

| Tab (sheet) | What it provides |
|---|---|
| **Dispatch** | Every trip (driver, vehicle, route, dates, KM, weight, freight, LR, status) |
| **Driver Details** | Driver master list (ID, name, mobile) |
| **Money Advance** | Bank/account advances (mode = Account) |
| **UPI Sheet** | UPI disbursements (mode = UPI) |
| **Cash Sheet** | Cash advances (mode = Cash) |
| **All Vehicle** | Vehicle list with wheel count (used to classify Truck vs Trailer) |
| **DIESEL&UREA** + **D&U** | Diesel/urea fillings (curated tab + running tab, merged) |
| **Attendance** | Driver×day grid of which truck each driver drove (or OFF) |

### Three ways to connect the data

All three paths end up in the same internal shape, so the rest of the app does not care which was used.

| Mode | How it works | Best when |
|---|---|---|
| **Google Sheets (proxy)** | Paste an Apps Script `/exec` proxy URL, click *Connect & load*. The proxy — a small helper script that reads your private Google Sheet on the app's behalf (see Glossary) — reads the live workbook and returns rows. A *Refresh* button re-pulls anytime. | You want always-live data with no manual export. |
| **Fetch from published URL** | Paste a Google Sheets "Publish to web" link, click *Fetch*. The whole workbook is downloaded and parsed in the browser. An *✕ Clear* button forgets the saved URL. | Quick checks. **Often blocked by the browser's security restrictions** — see warning below. |
| **Upload workbook file** | Drag-and-drop or pick a downloaded `.xlsx` file. Parsed entirely in the browser. | Offline use, or when the proxy/published fetch fails. |

> In the UI these appear as **two tabs** — **Google Sheets** (the proxy) and **Workbook (auto-fetch or upload)** — where the Workbook tab holds both the published-URL fetch and the file upload side by side (fetch on the left, upload on the right). The published-fetch and upload paths run as the same internal mode, so the rest of the app treats them identically.

```
                         ┌─────────────────────────────┐
  Master P&L Workbook ──▶│  (1) Apps Script proxy       │──┐
  (Google Sheets)        │  (2) Published-URL fetch     │  │   one internal
                         │  (3) .xlsx upload            │  ├──▶  state.sheets
                         └─────────────────────────────┘  │   { dispatch, drivers,
                                                            │     advances, upi, cash,
  Diesel & Attendance load automatically from the same ────┘     vehicles, diesel,
  workbook with their own status lines.                          attendance }

  Name mapping: dispatch (= Dispatch) · drivers (= Driver Details) ·
  advances (= Money Advance) · upi (= UPI Sheet) · cash (= Cash Sheet).
```

> **Important — running the file directly breaks live fetches.** If you open `index.html` as a local file (`file://`), the browser blocks the live data connections and you'll see *"Failed to fetch."* A warning banner appears in this case. Serve the app over `http://localhost` (or use the deployed web URL), or use the `.xlsx` upload path, which works without a server.

> **Published-URL fetch caveat:** Google's workbook export redirects to a host that does not send the headers a browser needs, so this path is frequently blocked. The app catches this and steers you to the `.xlsx` upload or the proxy.

### Diesel & attendance specifics

- **Diesel** rides inside the same workbook. Two tabs (`DIESEL&UREA` curated + `D&U` running) are read and merged so duplicates are de-duplicated while genuine extra fillings are kept.
- **Attendance** is read from the Attendance tab and turned into a per-driver day grid. The grid is cached locally so the panel and active-driver detection keep working between reloads; raw rows are re-loaded each session for the per-trip anomaly flags.
- Both diesel and attendance are **optional** — an older proxy deployment that doesn't know about them degrades gracefully (it keeps any previously cached data rather than wiping it).

### Two operating modes — sign in for real settlements

The app behaves differently depending on whether you have logged in:

- **Signed-in mode (normal):** you logged in with email/password. All protections are active — advance locking (so the same advance can't be deducted twice) and the Coverage screen both work.
- **Proxy-only / not-signed-in mode:** you loaded data but did not log in. The app still works for viewing and calculating, but it does **not** lock advances against double-deduction.

**Always sign in before doing real settlements.** Other notes below that mention "proxy-only mode" or "signed-in mode" refer back to this distinction.

---

## 3. The settlement workflow, end to end

The main screen is a **9-step linear wizard** with a stepper pill bar across the top: **Upload → Driver → Period → Trips → Advances → Per-Trip → Adjustments → Summary → Done**. A top **Prev / Next** bar moves you through it.

> **Navigation rules:** You can click a stepper pill to jump **backward** to a step you've already reached, but you cannot skip ahead by clicking — forward movement always goes through **Next**, so each step's validation and data-loading runs first.

> **Note on step numbers:** This guide numbers the steps starting at 0 (Connect data = Step 0) to match the diagram below; on screen the same steps are labelled **Step 1 through Step 9**. They are the same steps, just numbered from 1.

### Step 0 — Connect data source

The connect screen has **two tabs**: **Google Sheets** (the proxy) and **Workbook (auto-fetch or upload)**. The Workbook tab contains both the published-URL fetch panel (left) and the drag/drop `.xlsx` upload panel (right) — there is no separate third tab. Pick a tab, then load the workbook. A summary shows row counts for **Dispatch / Money Advance / UPI Sheet / Cash Sheet / Driver Details**, how many vehicles were classified, and how many settled trips are on file. Diesel and attendance load automatically with their own status lines. The **Continue** button only enables on a successful load.

### Step 1 — Driver search + attendance panel

Type a driver ID. Matching is **live on every keystroke** — there is no search button. The app looks the ID up in Driver Details first (matched on Driver ID; if found it also pulls the name and mobile for display), then falls back to the Dispatch sheet (matched on Driver ID; only a name is available there, no phone). Matching is always by ID — the name and mobile are shown, not searched. On a match it shows the driver's info and a month-by-month **attendance chip grid** (green = drove a truck that day, grey = OFF; hover a chip for the exact date and truck). On a miss it shows an error and blocks Continue.

### Step 2 — Period

The app pre-fills the period for you:
- **From** = the driver's last settlement date if one is found, otherwise 30 days ago (the default fallback).
- **To** = today.

Confirm or adjust the two dates. **The period excludes the start date and includes the end date.** Example: if a driver was last settled on May 1, the new period starts the day **after** May 1 — a trip dated exactly May 1 belongs to the previous settlement, not this one. A trip dated on the end date **is** included.

### Step 3 — Trips

The app pulls every trip for this driver inside the period and shows them in a table with **anomaly flags**. Each flag is a quick check to catch a likely data-entry error before you settle:

| Flag | What it means |
|---|---|
| Already settled | This trip is already part of a saved settlement and can't be re-used. |
| Missing freight | The freight amount is blank. |
| Missing KM | The distance is blank. |
| KM looks wrong | Trip distance is over 2,000 km, which is unusually high — check for a typo. |
| Weight loss over 2% | Delivered weight is more than 2% below loaded weight — possible shortage. |
| Negative duration | Trip end date is before its start date — likely a date entry error. |
| Duplicate LR | The same Lorry Receipt number appears on two trips. |
| Driver on two trucks same day | The same driver is recorded on two different trucks on one day. |
| Attendance conflict | The trip date conflicts with attendance (driver was OFF, or on a different truck). |

- Trips that were already settled in a prior record show a **🔒 Settled in `<id>`** badge and are locked — you cannot re-use them.
- Each row can be expanded for KM/weight/freight detail, removed/restored, and you can **add a manual trip** if needed.
- You **cannot proceed** if any non-removed trip is already settled.

### Step 4 — Advances

The app pulls the driver's advances from **three channels** — Money Advance (Account), UPI, and Cash — and splits them into two sections: **🔁 Carry-over from prior periods** (advances that were skipped previously and not yet recovered) and **Current period**.

- Each row shows date, a **Type** badge, a **Mode** badge (Cash / UPI / Account), amount, remark, and a Remove/Restore button.
- Rows already deducted in a past settlement are greyed out with a **🔒 Settled in `<ID>`** badge and a disabled *Locked* button.
- You can **add a manual advance** for anything paid off-sheet.
- A muted line shows the total **excluded from deductions** (Trip Settlement and Salary entries, which are never deducted).

### Step 5 — Per-trip questions

For each non-removed trip you confirm/answer:
- **Vehicle type** (Truck or Trailer — auto-detected from wheel count, can be overridden).
- **Fixed rate** for the route. If the From/To matches a **saved route**, its truck/trailer rate **and** its preloaded expense entries are loaded automatically (the saved route changes the money, not just the rate — see *Saved routes* below). Otherwise a suggested rate is snapped to ₹500 steps (default ₹3,500).
- **Trip type**: Full or Partial (with a partial %).
- **Expenses** logged via a popup in 5 categories: Loading/Unloading, Repairs, Toll+Mechanical, Road RTO/Police, Others.
- **Halt days** and halt rate (default ₹300/day) for company-caused waiting.

Each trip card shows a **live settlement total**. On the **fixed rate**, the hard limits are wide: it must be **₹0–₹20,000 in ₹500 steps**. But when a **saved route** supplies the rate, the step/range checks are skipped — only "rate must be greater than 0" is enforced. Other hard blocks: halt days can't exceed the trip duration, no negative amounts, and the partial % must be 1–100. The "expenses over ₹50,000" message is a **confirm-style warning**, not a hard block.

### Saved routes (the 📋 Routes master)

The **📋 Routes** button in the top toolbar opens a managed master of named routes. Each route stores a From → To, a name, a **truck rate**, a **trailer rate**, and optionally a **preloaded ₹** amount in each of the five expense categories (Loading/Unloading, Repairs, Toll, Road, Others).

- **Adding a route:** From and To are required, and both the truck rate and trailer rate must be positive. The doc id is **deterministic** from From + To, so re-adding the same From → To **updates** the existing route rather than creating a duplicate.
- **Editing / deleting:** only **admins** can Edit an existing route's rates; any signed-in user can **Delete** a route.
- **Printing:** a **🖨 Print** button exports all routes as a PDF table.
- **What it does on Step 5:** when a trip's From → To matches a saved route, the app loads **both** the fixed rate **and** the route's preloaded expense entries into that trip. The injected expenses are tagged **"from route"** so you can see where they came from. So a saved route changes the settlement amount, not just the rate — keep the preloaded expenses accurate.

### Step 6 — Diesel review + adjustments

Two parts:
- **(a) Diesel panel (information only):** shows the fillings that occurred on days **this exact driver had that exact truck** (matched via attendance and trip windows). It lists litres, rate, diesel ₹, KM, urea ₹, and the matched trip, with totals and an average ₹/L. **Nothing is auto-deducted** — the manager uses this as evidence to decide a bonus or penalty.
- **(b) Incentives (+) and Penalties (−):** add any number of bonus or penalty lines, each with an amount and a reason. They appear separately on the statement and PDF.

### Step 7 — Summary

Shows the full **Net Payable** breakdown: gross trip settlements, plus incentives, minus penalties, minus cash/UPI/account advances. A negative net shows a red *"Driver carries balance forward"* box. A banner warns if you're not signed in (you can't submit without signing in).

### Step 8 — Submit (Done)

On submit, the app:
1. Re-checks for last-second clashes against the live settled index (in case another user settled overlapping trips/advances while you worked).
2. Writes **one Firestore document** for the settlement, with status **Submitted**.
3. Immediately locks the trips and deducted advances so they can't be re-settled.
4. **Auto-downloads the PDF** statement.

The Done screen shows the settlement ID, net payable, and counts, plus buttons to Download PDF, export logs, or start a New Settlement.

```
  Step 0      Step 1       Step 2    Step 3   Step 4     Step 5      Step 6       Step 7    Step 8
 ┌──────┐   ┌────────┐   ┌──────┐  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌───────┐ ┌──────┐
 │Connect│─▶│Driver +│─▶│Period│─▶│Trips │▶│Advances│▶│Per-trip│▶│Diesel +  │▶│Summary│▶│Submit│
 │ data  │   │attend. │   │      │  │      │ │        │ │  Q&A   │ │adjustment│ │ (Net) │ │ +PDF │
 └──────┘   └────────┘   └──────┘  └──────┘ └────────┘ └────────┘ └──────────┘ └───────┘ └──────┘
```

---

## 4. How pay is calculated

### Per-trip settlement

For each trip the app computes:

```
factor        = (Trip Type = Full) ? 1.0 : (Partial % / 100)
fixedPay      = Fixed Rate × factor          ← partial % scales ONLY the fixed rate
haltTotal     = Halt Days × Halt Rate         (Halt Rate defaults to ₹300/day)
expensesTotal = Loading/Unloading + Repairs + Toll + Road + Others

Trip Settlement = round( fixedPay + haltTotal + expensesTotal )
```

Key points:
- **Partial % discounts only the fixed rate.** Halt pay and all five expense categories are reimbursed **in full** even on a partial trip, because the driver actually incurred those costs.
- **Expenses and halt are added** (reimbursed to the driver), never subtracted.
- Rounding happens once, on the whole trip total.

### Net Payable (the rollup)

```
Gross         = sum of every trip's settlement
cashAdv       = sum of deductible advances with Mode = Cash
upiAdv        = sum of deductible advances with Mode = UPI
accountAdv    = sum of deductible advances with Mode = Account

NET PAYABLE = Gross + Incentives − Penalties − cashAdv − upiAdv − accountAdv
```

- Only **deductible** advances reduce pay. An advance whose type is *Trip Settlement* or *Salary* is **never** deducted; everything else (Trip Advance, Salary Advance, blank/unknown type) is. Note this type-based exclusion only reaches the **Account** channel and manual entries — **UPI and Cash advances are always deducted** (see Section 5 for why).
- **Diesel never affects the math** — it is evidence only.
- If Net Payable is negative, the driver **carries the balance forward** to the next settlement.

> The same formula is used whether you create a new settlement or edit a saved one, so the numbers always match. (Technical detail on how the two are kept in sync is in Section 9.)

---

## 5. Advances & the locking / carry-over system

The single most important promise of this system is: **an advance is deducted from a driver exactly once, ever.**

### Where advances come from

| Channel | Source tab | Mode | Notes |
|---|---|---|---|
| Account | Money Advance | Account | Driver + type parsed from `REMARK 1`, or explicit Driver ID column. This is the **only** channel that can produce a non-deductible type (Salary / Trip Settlement, from the `SL` / `TS` codes). |
| UPI | UPI Sheet | UPI | Reads amount from the **GROSS TYPE** column (not IMPREST); skips non-"payment" vouchers; ignores placeholder driver `D00000`. **UPI rows carry no parsed type** — every UPI row is treated as a deductible *Trip Advance*, so the Trip Settlement / Salary exclusion does **not** apply to UPI. |
| Cash | Cash Sheet | Cash | Driver by ID column, else by name match; prefers the cleaned "Standard Date". Cash rows are **always deductible** — the parser only ever emits *Salary Advance* or *Trip Advance* (both deductible), even for a remark that plainly says "SALARY". |

### Deductibility

Every disbursement to the driver is recovered **except** the payout itself (**Trip Settlement**) and base **Salary**. A blank or unknown type is treated as deductible.

**Important — the exclusion only applies to some channels.** Automatic non-deductible classification (Salary / Trip Settlement) arises **only** from the Account channel's `REMARK 1` codes (`SL` / `TS`), or from a manually-added advance whose Type is set to one of those values. The Cash and UPI channels never produce a non-deductible type: Cash rows are always *Salary Advance* or *Trip Advance* (both deductible), and **UPI rows are always classified *Trip Advance* and are always deducted** — a UPI payment that was really a trip-settlement payout or base salary will still reduce the driver's Net Payable. Type-based exclusion protects only Account and Cash, never UPI.

### Locking (no double-pay)

When a settlement is finalised, each advance that was actually deducted gets a stable **Row Key** (`DriverID | Date | Mode | RoundedAmount | Position`) written into the cloud. A live listener rebuilds a **deducted-advances index** across the whole company in real time, so within about a second of one user submitting, those advances show as **🔒 Locked** for everyone else. If an admin deletes a settlement, its advances unlock automatically.

> The Row Key deliberately **excludes the remark/voucher text**, because that text drifts between spreadsheet exports and would otherwise unlock advances on every re-upload. Two genuinely-different advances on the same day/mode/amount are told apart by a position counter.

### Carry-over (nothing forgotten)

If you **remove/skip** an advance instead of deducting it, that advance is **not locked**. It automatically **resurfaces as a carry-over row** at the top of the driver's *next* settlement, and keeps resurfacing until it is eventually deducted. So skipping an advance defers it — it is never lost and never double-counted.

> **Mode caveat:** Per-advance locking works only in **signed-in mode** (see "Two operating modes" at the end of Section 2). In proxy-only / not-signed-in mode there is no advance lock — carry-over still surfaces, but duplicate-advance protection depends on being signed in. This is why you should always sign in before doing real settlements.

---

## 6. Diesel & attendance

### How fillings are matched to the right driver

The diesel panel on Step 6 shows a filling **only** when both of these hold for the day of the filling:
1. The truck is one of **this driver's** trip vehicles, and the filling date is inside the period (after the start date, up to and including the end date).
2. **Attendance agrees** the driver was on that truck that day.

The decision is **attendance-first**:

| Attendance says | Result |
|---|---|
| Driver was on **this truck** that day | **Keep** the filling |
| Driver was **OFF** or on a **different truck** | **Drop** it (even if a trip window covers the day) |
| **No record** (unknown) | Keep only if a trip of this driver on that truck spans the day; otherwise drop. For a trip with no end date, the "spans the day" window runs up to the next same-truck trip's start (and is just the start day for the last trip). |

This prevents fillings from one driver's day being credited as evidence against a different driver who later had the same truck. The matched list is **informational only** — it is printed on the PDF and stored on the record, but it never changes the money.

### The attendance panel

On the Driver step, a blue **📅 Attendance** card shows each month with a summary (e.g. *"5 days driving, 2 OFF · HR55AB1234"*) and a row of day chips (green = drove, grey = OFF). Days with no record show no chip.

### Anomaly flags

When reviewing trips, rows get warnings like **"Driver on OFF day"** or **"Attendance shows HR55AB1234, not HR12CD9999"** when a trip date conflicts with attendance.

> Anomaly flags need a **fresh workbook load** this session — they read raw attendance rows, which (unlike the compact attendance index) are not cached between reloads.

### Active drivers

A driver is **active** if attendance shows them on a truck (not OFF) on at least one of the **last 15 days**. This drives the "Active only" filter and the active count on the Coverage screen.

---

## 7. Settlement Coverage

The **📋 Coverage** button (top toolbar) opens a roster-wide dashboard that answers: *"Who has been settled, up to what date, and where are the gaps?"* It is **read for everyone, write for admins**.

For each driver it shows:
- **Last settled up to** — the end date of their most recent covered range (or *never settled*).
- **Unsettled for** — an urgency badge:

| Days since last settled | Badge |
|---|---|
| No settlements at all | red **"never settled"** |
| 0–15 days | green **(on track)** |
| 16–30 days | amber **(due soon)** |
| 31+ days | red **(overdue)** |

- **Gaps between settlements** — uncovered spans between consecutive settled ranges.
- **Settled ranges** — the count of in-app settlements plus grey **✍ from → to** badges for admin-recorded outside-software settlements.
- An **active** badge if the driver drove in the last 15 days.

Rows are sorted **most overdue first** (never-settled drivers float to the top). A search box filters by ID/name, and an **Active only** toggle limits the list.

### Combining in-app and outside-software settlements

Coverage merges settlements done **inside the app** with admin-recorded **manual ranges** (paper / legacy settlements done outside the software) so the gap picture reflects reality. Two ranges are considered continuous (no gap) when one ends and the next begins on the same date.

### Admin actions

- **+ Add range** — record an outside-software settled period (from, to, optional note).
- **✕ Delete range** — remove a manual range (there is no edit — delete and re-add to correct one).
- **Select multiple → ✓ Mark N selected settled till today** — bulk-record many drivers as fully settled up to today in one action. Entering selection mode adds helper buttons — **Select all active**, **Select all shown**, and **Clear selection** — and the confirm dialog reports how many of the selected drivers are **skipped** because they are already settled through today.

> **Honor system:** Add-range and bulk-settle are manual **assertions**, NOT real settlements the app calculated. Bulk-settle marks selected drivers as fully settled up to today, instantly clearing all their gaps and resetting their "unsettled for" clock — even though no actual settlement ran. Use it only to record genuine legacy/outside settlements, never as a shortcut. (Internally bulk-settle writes a range starting at `2000-01-01`, which is just a far-past placeholder so the whole history reads as covered.)

> Coverage counts a span as "covered" if **any** settlement record exists for it — even a *Submitted* (not yet paid) one counts the same as a *Paid* one.

> Only drivers whose ID starts with `D` + a digit (e.g. `D01625`) or `DMRD` appear on the Coverage screen; other IDs are treated as junk and excluded.

---

## 8. Records, lifecycle, editing & outputs

### The status lifecycle

Every settlement moves through three states. **Paid is terminal and permanently locked.**

```
   create (basic+)        verify (manager+)       finalise & pay (admin)
  ────────────────▶  Submitted  ──────────▶  Verified  ──────────────▶  Paid 🔒
                     (gold)                  (blue)                     (green, immutable)
```

- **Submitted** — created by any signed-in user via the wizard.
- **Verified** — a manager (or admin) confirms it. Instant, no prompt.
- **Paid** — an admin finalises it, enters a payment date (YYYY-MM-DD), confirms, and the record locks forever. A PAID-stamped final PDF downloads automatically.

### The Records modal

Lists up to 500 settlements, ordered by the settlement **'Date'** field descending (newest first), with ID, date, driver, net payable, and a colored status badge. (Ordering is by the settlement run date, which is normally — but not strictly — the same as creation order.) From a row you can **Open**, download **PDF**, and (admins) **Delete**.

Opening a record shows an editable detail screen: trip cards (rate, halt, expenses), an advances table (editable amount + Deducted + Remove), a read-only diesel evidence table, separate Incentives/Penalties tables, and a live Net Payable summary.

Managers/admins can also **add new rows to an already-saved settlement**:
- An **Add trip** mini-form (Trip No, date, vehicle, route, fixed rate, trip %) appends a manual trip.
- An **Add advance** mini-form (amount, date, **Mode**, **Type**, remark) appends an advance.
- Each advance has a **Remove** button — removing an advance returns it to the carry-over pool, so it resurfaces as carry-over in the driver's next settlement.

These changes are logged in the edit trail as **Trips added** / **Advances added** / **Removed** entries.

Which buttons appear depends on role and status:

| Button | Condition |
|---|---|
| Save changes | not Paid, manager+ |
| Mark Verified | not Paid, manager+, status = Submitted |
| Finalise & Pay | not Paid, admin, status = Verified |
| Download PDF | always |

Once **Paid**, all inputs are disabled and only Download PDF remains.

### Editing & the audit trail

- Edits live in the screen until you click **Save changes**. If you re-open the record without saving, **unsaved edits and any added rows are discarded** — there is no autosave or unsaved-changes warning.
- On save, the app **diffs** your changes against the original and writes the settlement update plus one **edit-log entry per change** in a single atomic batch. The money is recomputed automatically.
- The **edit log** is an **append-only audit trail** (When / By / Field / Old → New). Entries can never be edited, and are only removed when an admin deletes the whole settlement.
- If nothing actually changed, it saves nothing ("No changes to save").

### Driver Folders

A separate **Folders** modal groups every settlement by driver (with count and total net), is searchable, and offers a one-click **cumulative PDF** that merges all of a driver's settlements into a single statement.

### Outputs

**PDF statement** (landscape A4) — the document handed to the driver. It contains:
- Navy/gold header with company name and "Driver Settlement Statement", plus a status stamp (gold PAID when finalised).
- Driver name/ID/phone, period, issue date, settlement ID.
- **Trip Details & Expenses** table (per-trip fixed/halt/each expense category/total, with column sums).
- **Diesel Fillings** table (only if present) with totals and average ₹/L.
- **Advances Deducted** (only deducted advances) split across columns, with a totals bar.
- **Net Settlement** summary (gross, incentives, penalties, cash/UPI/account advances, NET PAYABLE in gold).
- **Edit History** table (for saved records).
- A green **PAID** stamp with payment date when finalised.
- A signature strip (Prepared by / Cash / Account / UPI / Dispatch check / Finalised / Paid by) and per-page footers.

**Excel exports:**
- **Full records export** (from the Records modal) — a 5-sheet workbook (Summary, Trip Details, Advances, Truck Log, Edit Log) pulled from the cloud. **For a real export, always use this.** It is the authoritative export.
- **Driver Log / Truck Log / Settled Index** (Step 0, "XLSX mode") — leftovers from an older offline version. They will usually produce an **empty file** when you are signed in to the cloud — **ignore them** and use Full records export instead.

> All money on the PDF is shown in whole rupees with Indian digit grouping (no paise). Note that a few header lines use a Unicode arrow that may render as a box in some PDF viewers.

---

## 9. Architecture & data model *(technical)*

### Single-file design

The entire application is **one file**, `index.html` (~4,562 lines): embedded HTML, a single `<style>` block, and one large `<script>` block. There is **no framework, no bundler, and no build step**. External libraries load from CDN only:

| Library | Version | Purpose |
|---|---|---|
| SheetJS / xlsx | 0.18.5 | Read `.xlsx` workbooks in the browser |
| jsPDF + jspdf-autotable | 2.5.1 / 3.6.0 | Generate the PDF statements |
| Firebase compat SDK | 10.14.1 | Auth + Firestore |

The backend is **Firebase**: Auth (email + password), Firestore (data), and Firebase Hosting (deploy target). There is no application server — the browser talks straight to Firestore, with security enforced by Firestore rules.

> The Firebase config (including the API key) is committed in plaintext in `index.html`. This is normal and safe for Firebase web apps — the API key is not a secret; real protection comes from Auth + Firestore rules, which end in a default-deny.

### Authentication & roles

- A full-screen login overlay blocks the app until sign-in.
- On sign-in, the app reads `users/{uid}` from Firestore to get the role. **If no such document exists, the user is force-signed-out** ("No role assigned"). An Auth account alone is not enough — the role doc is mandatory.
- Roles are stored in the `users` doc (not in Auth custom claims). The same three-tier hierarchy is mirrored client-side (to hide UI) and server-side (to enforce).

### Firestore collections

```
users/{uid}                         = { email, name, role }            role ∈ {basic, manager, admin}
settlements/{settlementId}          = one settlement document (shape below)
settlements/{id}/editLog/{entryId}  = append-only audit entry
routes/{routeId}                    = shared route rate master (deterministic id from From+To)
manualSettledRanges/{rangeId}       = { driverId, from, to, note, addedBy, addedByName, addedAt }
```

### Settlement document shape

Field names are **Title-Case-with-spaces** because they mirror the spreadsheet columns; the security rules assert on these exact names.

```
settlements/{settlementId} = {
  // summary (Title-Case)
  'Settlement ID', 'Date', 'Driver ID', 'Driver Name',
  'Period From', 'Period To', 'Trip Count',
  'Gross', 'Incentive', 'Incentive Reason', 'Penalty', 'Penalty Reason',
  'Cash Advances', 'UPI Advances', 'Account Advances', 'Net Payable',
  'Status',            // 'Submitted' | 'Verified' | 'Paid'
  'Last Edited', 'Payment Date', 'Finalised On',

  // camelCase arrays
  incentives: [ { amount, reason } ],
  penalties:  [ { amount, reason } ],
  diesel:     [ { date, pump, vehicle, qty, rate, amount, km, ureaAmt, matchedTrips, via } ],

  // embedded arrays
  trips:    [ { 'Trip No','Vehicle','Fixed Rate','Trip %','Halt Days','Halt Rate','Halt Total','Exp …','Trip Settlement', … } ],
  advances: [ { 'Mode','Type','Amount','Deducted','Row Key', … } ],
  truckLog: [ { per-vehicle margin = freight − driverPay } ],

  // provenance
  createdBy, createdByName, createdAt   // createdAt = serverTimestamp()
}
```

The document id is **time-based and unique per submit**: `S-<YYYYMMDD>-<driverId>-<last 6 digits of the current millisecond timestamp>`. It is **not** deterministic — resubmitting the same settlement yields a new id. (Contrast with `routeDocId`, which genuinely is deterministic from From + To.)

> **Two recompute engines, kept in sync (technical):** the wizard uses one formula (`calcTripSettlement`); when a *saved* record is edited later, a separate recompute (`recomputeSettlementDoc`) re-derives the numbers from the stored fields. They are intentionally equivalent — a maintainer changing one must change the other. One substantive behavioral difference: **at edit time, deductibility is frozen.** `recomputeSettlementDoc` sums only advances whose stored `Deducted` flag is `'Yes'` (set once at submission from `isDeductibleAdvance`) and buckets anything not Cash/UPI into Account; it does **not** re-derive deductibility from the advance's type. The edit UI exposes the Deducted checkbox and amount, not the type — so changing an advance's type after the fact has no effect on the math; only toggling Deducted or changing the amount does.

### Security rules summary

- **Default deny** at the end of the ruleset.
- `users` — read your own doc (admins read all); **write is admin-only**.
- `settlements` —
  - **create**: basic+ AND forced to `Status == 'Submitted'`, `createdBy == auth.uid`, empty Payment Date / Finalised On.
  - **update**: manager+ AND the existing doc is **not** Paid; a non-admin manager may not set Status to Paid nor change Payment Date / Finalised On (admin-only).
  - **delete**: admin-only.
- `editLog` — read basic+; create manager+ with `editedByUid == auth.uid`; **update always false** (immutable); delete admin-only (cascade).
- `routes` — read/create/update/delete for any signed-in user (the admin-only UI restriction is cosmetic).
- `manualSettledRanges` — read basic+; create admin-only with `addedBy == auth.uid`; **update false**; delete admin-only.

> The create rule validates only those four control fields — it does **not** verify trip/advance amounts or the Net Payable math. Money correctness is enforced entirely client-side.

### Live listeners (real-time locking)

While signed in, two Firestore `onSnapshot` listeners run:
- **routes** — mirrors the shared route master so any user's route edit appears everywhere within ~1s.
- **settlements** — rebuilds a settled index `{ trips, deductedAdvances }` on every change, so already-settled trips and the specific deducted advances are locked across all users in real time, and unlock automatically when an admin deletes a settlement.

On submit, the app re-checks this live index right before writing (optimistic check, not a transaction) and aborts if another user just settled overlapping items.

### The Apps Script proxy

`apps-script/Code.gs` is a Google Apps Script Web App (deployed as `/exec`, executes as the owner, accessible to anyone with the URL). The browser hits it because it cannot read private Google Sheets directly.

- `doGet`: `?action=ping` (health) and `?action=read&which=<source>` (returns rows). Date cells are formatted in the **spreadsheet's** timezone to avoid a one-day shift.
- `doPost` (sent as `text/plain` to avoid a CORS preflight): `lastSettlement`, `settledIndex`, and a legacy `finalize`.
- The client requires the proxy URL to match `^https://script.google.com/` and caches it per browser.

> **Vestigial code:** The proxy's `finalize` action and all history-sheet writes are **never called** by the current app — submission writes straight to Firestore. The proxy is used only for reading sheets and (in proxy-only mode) for `lastSettlement` / `settledIndex`. Once signed in, the Firestore listener owns the settled index regardless of input mode.

---

## 10. Operations

### Live URL

```
https://driver-settlement-79646.web.app
```

(Firebase project `driver-settlement-79646`.)

### Deploying

The app is a single static `index.html` plus the Firestore rules.

```bash
# Deploy the app (Firebase Hosting)
firebase deploy --only hosting

# Deploy/update the security rules
firebase deploy --only firestore:rules
```

### Provisioning users (offline only)

There is **no in-app signup**. An admin runs the Node script `scripts/provision-users.mjs`, which uses `firebase-admin` and a git-ignored `service-account.json` to create the Auth user **and** their `users/{uid}` role doc together. It is **idempotent** — re-running updates roles.

> **Before real use:** the script ships with placeholder seed accounts (`admin@traq.in`, `manager1/2@traq.in`, `basic1/2@traq.in`) all sharing the temporary password `Traq@2026`. These must be edited, and users should reset passwords via the Firebase console. The `service-account.json` is required and is not in the repo.

### Apps Script setup

For Google Sheets (proxy) mode, deploy `apps-script/Code.gs` as a Web App, then paste its `/exec` URL into the **Google Sheets** tab on Step 0. The URL is remembered per browser.

> The `apps-script/SETUP.md` documentation is partly **stale** — it describes a single `Settlement Data` tab, but the current `Code.gs` reads three separate sources (`moneyAdvance`, `upiSheet`, `cashSheet`) with all tabs headed on row 1. Trust `Code.gs`, not the older setup notes.

### Local cache & offline behavior

- Diesel rows and the attendance **index** are cached in browser `localStorage`, so a reload shows the cached data until you reload the workbook.
- The saved proxy/fetch URLs are also remembered per browser.
- Per-advance locking and the Coverage screen require being **signed in** (see "Two operating modes" at the end of Section 2); proxy-only / not-signed-in mode falls back to "no advance lock."
- Running as a `file://` page silently breaks live fetches — always serve over `http://localhost` or use the deployed URL (or the `.xlsx` upload path).

### Naming note (cosmetic rebrand)

**Harmless naming leftovers:** the app shows your brand, **Daman Mandeep Roadlines**, everywhere it matters. Internally the code still carries old project names — **GRUBUS** (script header, `localStorage` keys prefixed `grubus_`, Apps Script header) and a few keys using a third name, **TRAQ** — plus an old **v1.0** version label (despite the folder being named `new-settlement-app-2.0`). None of this affects how the app works or your data. Renaming the internal labels would risk orphaning saved local data, so they were intentionally left alone.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Settlement** | The full pay calculation for one driver over one period, saved as one cloud document. |
| **Settlement period** | The date range being paid. The start date (the last settlement date) is **excluded**; the end date is **included**. So a trip dated exactly on the start date belongs to the previous settlement. |
| **Net Payable** | The final amount owed to the driver: gross + incentives − penalties − advances. |
| **Fixed rate** | The base pay for a route, per trip (scaled by partial % for partial loads). |
| **Trip % / Partial** | A partial/half load pays a percentage of the fixed rate only (halt and expenses are still paid in full). |
| **Halt** | A per-day allowance for company-caused waiting (default ₹300/day). |
| **Advance** | Money already paid to the driver (cash, UPI, or bank) that is recovered from their settlement. |
| **Carry-over** | A skipped (not-yet-deducted) advance that resurfaces in the driver's next settlement until it is deducted. |
| **Deductible advance** | Any advance except *Trip Settlement* and *Salary*, which are never deducted. The exclusion is only reachable on the **Account** channel (and manual entries); **UPI is always deducted** (always *Trip Advance*) and **Cash is always deducted** — see Section 5. |
| **Row Key** | A stable identifier for an advance (`DriverID | Date | Mode | Amount | Position`) used to lock it so it can't be deducted twice. |
| **Settled index** | The live, company-wide map of which trips and advances are already settled (and therefore locked). |
| **LR** | Lorry Receipt — the consignment document number for a trip; duplicates are flagged as an anomaly. |
| **Diesel matching** | Showing only the fuel fillings on days this driver actually had this truck (decided via attendance + trips); evidence only, never deducted. |
| **Active driver** | A driver who drove (not OFF) on at least one of the last 15 attendance days. |
| **Coverage** | The roster-wide view of who has been settled up to when, including outside-software ranges, and where the gaps are. |
| **Manual settled range** | An admin-recorded period a driver was settled **outside** the software, so Coverage shows true gaps. |
| **Edit log** | The append-only audit trail of every change to a saved settlement. |
| **Status lifecycle** | Submitted → Verified → Paid; Paid is permanent and immutable. |
| **Proxy** | The Apps Script Web App that reads the company's private Google Sheets on the app's behalf. |
```
