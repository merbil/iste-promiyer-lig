import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = 22667;              // <-- your league id
const SLEEP_MS = 300;                 // be polite

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'iste-promiyer-lig' }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  // current GW
  const bootstrap = await getJson(`${BASE}/bootstrap-static/`);
  const events = bootstrap.events || [];
  const currentEvent = events.find(e => e.is_current) || events.find(e => e.is_next) || events[events.length - 1];
  const currentGW = currentEvent?.id ?? events.length;

  // league standings (paginate)
  let page = 1, allEntries = [];
  while (true) {
    const s = await getJson(`${BASE}/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`);
    const results = s?.standings?.results || [];
    allEntries = allEntries.concat(results);
    if (!s?.standings?.has_next) break;
    page += 1;
    await sleep(SLEEP_MS);
  }

  // per manager: gw points + transfers for current GW
  const managers = [];
  for (const r of allEntries) {
    const entryId = r.entry;

    const history = await getJson(`${BASE}/entry/${entryId}/history/`);
    const chips = (history?.chips || []).map(c => ({ event: c.event, name: c.name }));
    const transfers = await getJson(`${BASE}/entry/${entryId}/transfers/`);

    // GW points up to current GW (hide unplayed)
    // Start with history but compute NET for past GWs = points - event_transfers_cost
    const gwMap = new Map(
      (history?.current || []).map(x => [
        x.event,
        (Number(x.points) || 0) - (Number(x.event_transfers_cost) || 0)
      ])
    );

    // For the current GW, ensure we use NET = points - event_transfers_cost
    try {
      const picks = await getJson(`${BASE}/entry/${entryId}/event/${currentGW}/picks/`);
      const eh = picks?.entry_history || {};
      if (eh && Number.isFinite(Number(eh.points))) {
        const gross = Number(eh.points) || 0;
        const hit   = Number(eh.event_transfers_cost) || 0;
        const net   = gross - hit;
        gwMap.set(currentGW, net);
      }
    } catch (e) {
      // If the picks endpoint fails, fall back to history value (often already net)
    }

    const gwPoints = [];
    for (let gw = 1; gw <= currentGW; gw++) gwPoints.push(gwMap.get(gw) ?? null);

    // transfers only for current GW
    const latestGwTransfers = transfers
      .filter(t => t.event === currentGW)
      .map(t => ({ in: t.element_in, out: t.element_out }));

    managers.push({
      teamName: r.entry_name,
      playerName: r.player_name,
      total: r.total,
      entryId,
      chips,
      gwPoints,
      latestGwTransfers
    });

    await sleep(SLEEP_MS);
  }

  // map element ids -> names for nicer transfer text
  const elementsById = new Map(bootstrap.elements.map(e => [e.id, e.web_name]));
  for (const m of managers) {
    m.latestGwTransfers = m.latestGwTransfers.map(t => ({
      in: { id: t.in, name: elementsById.get(t.in) || String(t.in) },
      out: { id: t.out, name: elementsById.get(t.out) || String(t.out) }
    }));
  }

  // --- Validation: per-manager sum(gwPoints) should match reported total ---
  // This helps catch any net/gross inconsistencies before we publish.
  (() => {
    const mismatches = [];
    for (const m of managers) {
      const sumGW = m.gwPoints.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
      if (sumGW !== m.total) {
        mismatches.push({ team: m.teamName, entryId: m.entryId, total: m.total, sumGW });
      }
    }
    if (mismatches.length) {
      console.warn(`[VALIDATION] ${mismatches.length} manager(s) have total != sum(gwPoints):`);
      mismatches.slice(0, 20).forEach(x =>
        console.warn(` - ${x.team} (#${x.entryId}): total=${x.total}, sumGW=${x.sumGW}`)
      );
      if (mismatches.length > 20) console.warn(` ...and ${mismatches.length - 20} more`);
    } else {
      console.log('[VALIDATION] All totals match sum(gwPoints).');
    }
  })();
  // default sort: total desc
  managers.sort((a, b) => b.total - a.total);

  const payload = {
    leagueId: LEAGUE_ID,
    generatedAt: new Date().toISOString(),
    currentGW,
    managers
  };

  const outPath = path.join(__dirname, '..', 'data.json');
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote data.json for league ${LEAGUE_ID}, currentGW=${currentGW}, managers=${managers.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });