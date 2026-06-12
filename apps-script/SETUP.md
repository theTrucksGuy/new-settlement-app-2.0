# Pull data live from Google Sheets — Setup (~5 minutes)

This connects the GRUBUS Settlement app directly to your Google Sheets so you no
longer upload the workbook each time. A tiny Apps Script "proxy" reads the
**PROFIT & LOSS DASHBOARD** workbook and writes finalized settlements to a
separate **Settlement History** sheet. You do this once per browser.

---

## 0. Make sure your data is a Google Sheet

The proxy reads **Google Sheets**, not an `.xlsx` file. If "PROFIT & LOSS
DASHBOARD" only exists as an Excel file, upload it to Google Drive and open it
with **Google Sheets** (File → Save as Google Sheets), or import it into a new
Google Sheet. The tabs must keep these names:

`DISPATCH SHEET` · `Settlement Data` · `Driver Details` · `All Vehicle` · `DIESEL&UREA` *(optional — per-truck diesel fillings shown during settlement)* · `Attendance` *(optional — driver×day grid shown after driver search)*

---

## 1. Get your two Sheet IDs

The ID is the long string in the Sheet URL between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/1AbCdEf...XYZ/edit
                                       ^^^^^^^^^^^^^^^  ← this is the ID
```

You need:
- **workbookId** — the PROFIT & LOSS DASHBOARD sheet (Dispatch / Settlement Data / Driver Details / All Vehicle).
- **historySheetId** — a (possibly new, blank) Google Sheet where finalized settlements are saved. Create one now if you don't have it. *(Optional for read-only testing — you only need it before you finalize a settlement.)*

---

## 2. Create the Apps Script project

1. Go to <https://script.google.com> → **New project**.
2. Delete the default `Code.gs` content.
3. Copy the **entire contents** of `apps-script/Code.gs` from this repo and paste it in.
4. Rename the project (top-left) to e.g. "GRUBUS Settlement Proxy".

---

## 3. Fill in the CONFIG block

At the top of the script, paste your two IDs. The tab names already match the
workbook — leave them unless you renamed a tab:

```javascript
const CONFIG = {
  workbookId: 'PASTE_PROFIT_AND_LOSS_ID_HERE',
  historySheetId: 'PASTE_HISTORY_SHEET_ID_HERE',   // can stay '' until you finalize

  dispatchTab: 'DISPATCH SHEET',
  settlementDataTab: 'Settlement Data',
  driverDetailsTab: 'Driver Details',
  allVehicleTab: 'All Vehicle',

  historyTripTab: 'Driver Log',
  historySummaryTab: 'Settlements Summary',
  historyTruckTab: 'Truck Log',
  historyIndexTab: 'Settled Trips Index',
};
```

> The four History tabs are **created automatically** in the history sheet the
> first time you finalize a settlement — don't make them yourself.
> `Settlement Data`'s header is on row 2 (row 1 is a date banner); the script
> already handles that via `HEADER_ROW`.

---

## 4. Deploy as a Web App

1. **Deploy** → **New deployment** (top right).
2. Gear icon → **Web app**.
3. Set:
   - **Description:** `v1`
   - **Execute as:** *Me*
   - **Who has access:** *Anyone* (simplest) — or *Anyone with Google account* for stricter access.
4. **Deploy** → **Authorize access** → pick your Google account → accept.
5. Copy the **Web app URL** (ends in `/exec`). That's what you paste into the app.

---

## 5. Test the proxy

In a new tab, open the Web app URL with `?action=ping` appended:

```
https://script.google.com/macros/s/.../exec?action=ping
```

You should see:

```json
{"ok":true,"data":{"ok":true,"time":"...","configured":{
  "dispatch":true,"settlementData":true,"driverDetails":true,
  "allVehicle":true,"history":true}}}
```

If `dispatch / settlementData / driverDetails / allVehicle` show `false`, your
`workbookId` is missing. `history:false` just means you haven't set
`historySheetId` yet (fine until you finalize).

---

## 6. Connect the app to live data

1. Open `index.html`.
2. On the **Connect Data Source** screen, choose the **Google Sheets** tab (not "Upload workbook").
3. Paste the Web app `/exec` URL into the proxy URL field.
4. Click **Connect & load**. The summary should report row counts for Dispatch,
   Settlement Data, Driver Details, and "Vehicles classified".
5. The URL is remembered in this browser — you only paste it once. Use **Reload**
   to pull the latest data anytime.

---

## Updating the script later

When you edit `Code.gs` (e.g., a tab is renamed):

1. Edit the script.
2. **Deploy** → **Manage deployments** → pencil icon → **Version: New version** → **Deploy**.
3. The `/exec` URL stays the same.

> ⚠️ Clicking **New deployment** (instead of editing the existing one) gives a
> *new* URL you'd have to re-paste into the app.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ping` shows `dispatch:false` | `workbookId` not set, or the script wasn't redeployed after editing CONFIG. |
| `Cannot open spreadsheet` | Wrong ID, or your Google account can't access that Sheet. |
| Tab shows 0 rows | Tab name in CONFIG doesn't match the actual tab — check spelling/case. |
| `Settlement Data` rows look shifted | The date-banner row; confirm `HEADER_ROW.settlementData = 2` is present in the script. |
| "Connection failed" in app | URL wrong, deployment set to "Only myself", or not redeployed after an edit. |
| Finalize fails: "history sheet ID is not configured" | Set `historySheetId` and redeploy. |
| CORS error in console | Use the `/exec` deployment URL, not the `/dev` editor URL. |
