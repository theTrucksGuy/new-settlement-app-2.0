# Apps Script Proxy — Setup (5 minutes)

This proxy lets the local web app read your 3 Google Sheets and write back finalized settlements. You only do this once.

---

## 1. Find your sheet IDs

For each of your 3 sheets, open it in Google Sheets and copy the ID from the URL:

```
https://docs.google.com/spreadsheets/d/1AbCdEf...XYZ/edit
                                       ^^^^^^^^^^^^^^^
                                       this part is the sheet ID
```

You'll need 3 IDs:
- **Dispatch** sheet ID
- **Advances** sheet ID
- **Settlement History** sheet ID

---

## 2. Create the Apps Script project

1. Go to <https://script.google.com> and click **New project**
2. Delete the default `Code.gs` content
3. Copy the contents of `Code.gs` from this folder and paste it in
4. Rename the project (top-left) to something like "GRUBUS Settlement Proxy"

---

## 3. Fill in the CONFIG block

At the top of the script, paste your 3 sheet IDs:

```javascript
const CONFIG = {
  dispatchSheetId: 'PASTE_DISPATCH_ID_HERE',
  advancesSheetId: 'PASTE_ADVANCES_ID_HERE',
  historySheetId:  'PASTE_HISTORY_ID_HERE',

  dispatchTab: 'Sheet1',           // change if your tab is named differently
  advancesTab: 'Sheet1',
  // ...
};
```

Also update `dispatchTab` / `advancesTab` if your tabs aren't named `Sheet1`. The 4 history tabs (`Driver Log`, `Settlements Summary`, `Truck Log`, `Settled Trips Index`) will be **created automatically** the first time a settlement is finalized — you don't need to make them yourself.

Optional: fill in `routesSheetId`, `repairsSheetId`, `attendanceSheetId` if you have those as Google Sheets too. Leave blank otherwise — the app handles them being empty.

---

## 4. Deploy as a Web App

1. Click **Deploy** → **New deployment** (top right)
2. Click the gear icon → choose **Web app**
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** *Me*
   - **Who has access:** *Anyone* (for simplest local-app setup) — or *Anyone with Google account* if you want stricter access
4. Click **Deploy**
5. Google will ask for permissions — click **Authorize access**, pick your Google account, and accept
6. Copy the **Web app URL** that appears (ends in `/exec`)

That URL is what you paste into the GRUBUS app.

---

## 5. Test it

In a new browser tab, paste the Web app URL with `?action=ping` appended:

```
https://script.google.com/macros/s/.../exec?action=ping
```

You should see something like:

```json
{"ok":true,"data":{"ok":true,"time":"2026-05-07T...","configured":{"dispatch":true,"advances":true,"history":true,...}}}
```

If `dispatch/advances/history` shows `false`, double-check the IDs in step 3.

---

## 6. Wire it into the app

1. Open `index.html` in your browser
2. On the **Connect Data Source** screen, paste the Web app URL into the proxy URL field
3. Click **Connect & load**
4. The app remembers it — you only paste once per browser

---

## Updating the script later

When you change the script (different sheet, new tab name, etc.):

1. Edit the script
2. Click **Deploy** → **Manage deployments** → pencil icon → **Version: New version** → **Deploy**
3. The `/exec` URL stays the same

> ⚠️ If you click **New deployment** instead of editing the existing one, you'll get a *new* URL and have to re-paste it into the app.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot open spreadsheet` | Sheet ID wrong, or your Google account doesn't have access to that sheet |
| `Tab not found` | Tab name in CONFIG doesn't match the actual tab — check spelling/case |
| App shows "Connection failed" | URL is wrong, deployment is set to "Only myself" instead of "Anyone", or you didn't redeploy after editing |
| Finalize fails with permission error | Re-deploy: Authorization scopes change when you add `LockService` — the old auth might be missing it |
| CORS errors in browser console | Make sure you're using the deployment URL (`/exec`), not the editor URL (`/dev`) |
