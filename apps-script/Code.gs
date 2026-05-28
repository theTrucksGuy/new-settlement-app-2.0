/**
 * GRUBUS Settlement Engine — Apps Script Proxy v1
 *
 * Exposes a tiny REST endpoint the browser app talks to:
 *   GET  ?action=ping                       health check
 *   GET  ?action=read&which=<source>        return rows from a sheet as JSON
 *   POST {action:"lastSettlement",          driver's previous settlement date
 *         driverId:"D02028"}
 *   POST {action:"settledIndex"}            settled-trips index
 *   POST {action:"finalize", ...rows}       append driver-log + summary + truck + index rows
 *
 * Sources: dispatch | settlementData | driverDetails | allVehicle |
 *          historyTrip | historySummary | historyTruck | historyIndex
 *
 * Setup is documented in SETUP.md.
 */

const CONFIG = {
  /* REQUIRED — the ONE workbook that holds Dispatch, Settlement Data and
     Driver Details (the "PROFIT & LOSS DASHBOARD" sheet). Paste its ID from
     the URL: https://docs.google.com/spreadsheets/d/1AbCdEf.../edit → 1AbCdEf */
  workbookId: '',               // PROFIT & LOSS DASHBOARD Google Sheet ID

  /* Settlement History lives in its OWN separate sheet (finalized output).   */
  historySheetId: '',           // Settlement History Google Sheet ID

  /* Tab names inside the workbook above.                                     */
  dispatchTab: 'DISPATCH SHEET',
  settlementDataTab: 'Settlement Data',
  driverDetailsTab: 'Driver Details',
  allVehicleTab: 'All Vehicle',

  /* History tabs (separate sheet). Auto-created on first finalize if missing.*/
  historyTripTab: 'Driver Log',
  historySummaryTab: 'Settlements Summary',
  historyTruckTab: 'Truck Log',
  historyIndexTab: 'Settled Trips Index',
};

const SOURCES = {
  dispatch:       () => [CONFIG.workbookId,        CONFIG.dispatchTab],
  settlementData: () => [CONFIG.workbookId,        CONFIG.settlementDataTab],
  driverDetails:  () => [CONFIG.workbookId,        CONFIG.driverDetailsTab],
  allVehicle:     () => [CONFIG.workbookId,        CONFIG.allVehicleTab],
  historyTrip:    () => [CONFIG.historySheetId,    CONFIG.historyTripTab],
  historySummary: () => [CONFIG.historySheetId,    CONFIG.historySummaryTab],
  historyTruck:   () => [CONFIG.historySheetId,    CONFIG.historyTruckTab],
  historyIndex:   () => [CONFIG.historySheetId,    CONFIG.historyIndexTab],
};

// Some tabs carry a banner/metadata row above the real header. Map source →
// 1-based row that holds the column headers (default 1). Settlement Data has a
// Start/End-date banner on row 1, so its headers are on row 2.
const HEADER_ROW = {
  settlementData: 2,
};

function doGet(e) {
  return wrap_(() => {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'ping') {
      return {
        ok: true,
        time: new Date().toISOString(),
        configured: {
          dispatch:       !!CONFIG.workbookId,
          settlementData: !!CONFIG.workbookId,
          driverDetails:  !!CONFIG.workbookId,
          allVehicle:     !!CONFIG.workbookId,
          history:        !!CONFIG.historySheetId,
        },
      };
    }
    if (action === 'read') return { rows: readTab_(e.parameter.which) };
    throw new Error('Unknown GET action: ' + action);
  });
}

function doPost(e) {
  return wrap_(() => {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    if (action === 'lastSettlement') {
      const rows = readTab_('historySummary');
      const matches = rows.filter(r => norm_(r['Driver ID']) === norm_(body.driverId));
      matches.sort((a, b) => String(b['Date']).localeCompare(String(a['Date'])));
      return { lastDate: matches[0] ? String(matches[0]['Date']) : null };
    }

    if (action === 'settledIndex') {
      const rows = readTab_('historyIndex');
      const idx = {};
      rows.forEach(r => {
        const tn = String(r['Trip No'] || '').trim();
        if (tn) idx[tn] = {
          driverId: r['Driver ID'],
          settlementId: r['Settlement ID'],
          settledOn: r['Settled On'],
        };
      });
      return { settled: idx };
    }

    if (action === 'finalize') {
      const lock = LockService.getScriptLock();
      lock.tryLock(30000);
      try {
        appendRows_('historyTrip',    body.driverLogRows  || []);
        appendRows_('historySummary', body.summaryRow ? [body.summaryRow] : []);
        appendRows_('historyTruck',   body.truckLogRows   || []);
        appendRows_('historyIndex',   body.settledIndexRows || []);
        return {
          ok: true,
          settlementId: body.summaryRow && body.summaryRow['Settlement ID'],
        };
      } finally {
        try { lock.releaseLock(); } catch (_) {}
      }
    }

    throw new Error('Unknown POST action: ' + action);
  });
}

function readTab_(which) {
  const fn = SOURCES[which];
  if (!fn) throw new Error('Unknown source: ' + which);
  const [id, tab] = fn();
  if (!id) return [];                      // not configured → empty
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('Cannot open spreadsheet ' + which + ': ' + e.message); }
  const sh = ss.getSheetByName(tab);
  if (!sh) return [];                      // tab missing → empty
  const data = sh.getDataRange().getValues();
  const hdr = HEADER_ROW[which] || 1;      // 1-based header row (skips banner rows)
  if (data.length < hdr + 1) return [];
  const tz = Session.getScriptTimeZone();
  const headers = data[hdr - 1].map(h => String(h).trim());
  const out = [];
  for (let i = hdr; i < data.length; i++) {
    const row = data[i];
    let hasValue = false;
    const o = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      let v = row[j];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      o[h] = v;
      if (v !== '' && v !== null && v !== undefined) hasValue = true;
    }
    if (hasValue) out.push(o);
  }
  return out;
}

function appendRows_(which, rows) {
  if (!rows.length) return;
  const fn = SOURCES[which];
  if (!fn) throw new Error('Unknown source: ' + which);
  const [id, tabName] = fn();
  if (!id) throw new Error(which + ' sheet ID is not configured');
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);

  const allKeys = [];
  const seen = {};
  rows.forEach(r => Object.keys(r).forEach(k => { if (!seen[k]) { seen[k] = 1; allKeys.push(k); } }));

  let headers;
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  if (lastRow === 0 || lastCol === 0) {
    headers = allKeys.slice();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const missing = allKeys.filter(k => headers.indexOf(k) === -1);
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
    }
  }

  const matrix = rows.map(r => headers.map(h => r[h] != null ? r[h] : ''));
  sh.getRange(sh.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
}

function norm_(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

function wrap_(fn) {
  try {
    const data = fn();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
