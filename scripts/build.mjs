import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
 
const __dirname = path.dirname(fileURLToPath(import.meta.url));
 
const BASE = 'https://fantasy.premierleague.com/api';
const LEAGUE_ID = 162916;             // <-- your league id
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
  let page = 1, allEntries = [], league = null;
  while (true) {
    const s = await getJson(`${BASE}/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`);
    if (!league) league = s?.league || null;
    const results = s?.standings?.results || [];
    allEntries = allEntries.concat(results);
    if (!s?.standings?.has_next) break;
    page += 1;
    await sleep(SLEEP_MS);
  }
 
  // Live points for every player this GW (one request, shared by all lineups)
  const livePts = await getLivePoints(currentGW);
  const lookups = {
    elements: new Map(bootstrap.elements.map(e => [e.id, e])),
    teams: new Map((bootstrap.teams || []).map(t => [t.id, t.short_name])),
    livePts
  };

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
 
    // For the current GW, derive the cell from the league standings so it tracks
    // the same (leading) cadence as the Total column and never lags like the picks
    // endpoint did (that lag made GW cells read low, e.g. 30, while Total was
    // already settled at 66). We use total - (sum of settled earlier GWs) rather
    // than event_total directly, so the value is guaranteed net of any transfer
    // hits and sum(gwPoints) always equals total.
    let settledEarlier = 0;
    for (let gw = 1; gw < currentGW; gw++) {
      const v = gwMap.get(gw);
      if (Number.isFinite(v)) settledEarlier += v;
    }
    if (Number.isFinite(Number(r.total))) {
      gwMap.set(currentGW, Number(r.total) - settledEarlier);
    }
 
    const gwPoints = [];
    for (let gw = 1; gw <= currentGW; gw++) gwPoints.push(gwMap.get(gw) ?? null);
 
    // transfers only for current GW
    const latestGwTransfers = transfers
      .filter(t => t.event === currentGW)
      .map(t => ({ in: t.element_in, out: t.element_out }));

    // starting XI + bench for current GW (null if FPL doesn't serve it yet)
    const lineup = await getLineup(entryId, currentGW, lookups);
    if (lineup) {
      const now = (history?.current || []).find(x => x.event === currentGW);
      lineup.transferCost = Number(now?.event_transfers_cost) || 0;
    }

    managers.push({
      teamName: r.entry_name,
      playerName: r.player_name,
      total: r.total,
      entryId,
      chips,
      gwPoints,
      latestGwTransfers,
      lineup
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
  // League cup (FPL creates a knockout cup league late in the season; the final is GW38).
  // cup_league stays null until the cup starts, so this is a no-op before then.
  const cup = await getCup(league);

  // default sort: total desc
  managers.sort((a, b) => b.total - a.total);
 
  const payload = {
    leagueId: LEAGUE_ID,
    generatedAt: new Date().toISOString(),
    currentGW,
    currentGWFinished: Boolean(currentEvent?.finished),
    cup,
    managers
  };
 
  const outPath = path.join(__dirname, '..', 'data.json');
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote data.json for league ${LEAGUE_ID}, currentGW=${currentGW}, managers=${managers.length}`);
}
 
// Live points per player, plus provisional bonus for matches whose bonus isn't confirmed yet
// (FPL's league totals already count provisional bonus; live total_points doesn't).
async function getLivePoints(gw) {
  let pts;
  try {
    const live = await getJson(`${BASE}/event/${gw}/live/`);
    pts = new Map((live?.elements || []).map(e => [e.id, Number(e.stats?.total_points) || 0]));
  } catch (err) {
    console.warn('[LINEUP] could not read live points for GW', gw, err.message);
    return new Map();
  }
  try {
    const fixtures = await getJson(`${BASE}/fixtures/?event=${gw}`);
    for (const f of fixtures || []) {
      if (!f.started) continue;
      const stat = (id) => (f.stats || []).find(s => s.identifier === id);
      const confirmed = stat('bonus');
      if (confirmed && (confirmed.h.length || confirmed.a.length)) continue; // already in total_points
      const bps = stat('bps');
      if (!bps) continue;
      for (const [element, bonus] of provisionalBonus([...bps.h, ...bps.a])) {
        pts.set(element, (pts.get(element) || 0) + bonus);
      }
    }
  } catch (err) {
    console.warn('[LINEUP] could not add provisional bonus for GW', gw, err.message);
  }
  return pts;
}

// FPL bonus: top 3 BPS get 3/2/1; ties share a rank (1,1,3 -> 3,3,1; 1,2,2 -> 3,2,2; 1,2,3,3 -> 3,2,1,1)
function provisionalBonus(entries) {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const out = [];
  sorted.forEach((e, i) => {
    const rank = i > 0 && sorted[i - 1].value === e.value ? out[i - 1][2] : i + 1;
    out.push([e.element, Math.max(0, 4 - rank), rank]);
  });
  return out.filter(([, bonus]) => bonus > 0).map(([el, bonus]) => [el, bonus]);
}

// Shape (read by script.js): { formation, points, benchPoints, picks: [11 starters, then 4 bench] }
// Each pick: { name, team, pos, pts, mult, c, vc, bench, subIn, subOut }
// pts are raw live points; mult is FPL's multiplier (0 bench / 1 / 2 captain / 3 triple captain).
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
async function getLineup(entryId, gw, { elements, teams, livePts }) {
  let data;
  try {
    data = await getJson(`${BASE}/entry/${entryId}/event/${gw}/picks/`);
  } catch (err) {
    console.warn(`[LINEUP] no picks for #${entryId} GW${gw}:`, err.message);
    return null;
  }
  const subsIn = new Set((data?.automatic_subs || []).map(s => s.element_in));
  const subsOut = new Set((data?.automatic_subs || []).map(s => s.element_out));
  const picks = (data?.picks || [])
    .sort((a, b) => a.position - b.position)
    .map(p => {
      const el = elements.get(p.element) || {};
      return {
        name: el.web_name || String(p.element),
        team: teams.get(el.team) || '',
        pos: POS[p.element_type || el.element_type] || 'MID',
        pts: livePts.get(p.element) ?? 0,
        mult: Number(p.multiplier) || 0,
        c: Boolean(p.is_captain),
        vc: Boolean(p.is_vice_captain),
        bench: p.position > 11,
        subIn: subsIn.has(p.element),
        subOut: subsOut.has(p.element)
      };
    });
  if (picks.length !== 15) return null;

  // Starters grouped GKP → FWD so the page can draw rows; bench keeps FPL's order
  const order = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
  const starters = picks.slice(0, 11).sort((a, b) => order[a.pos] - order[b.pos]);
  const bench = picks.slice(11);
  const count = (pos) => starters.filter(p => p.pos === pos).length;

  return {
    formation: `${count('DEF')}-${count('MID')}-${count('FWD')}`,
    points: picks.reduce((a, p) => a + p.pts * p.mult, 0),
    benchPoints: bench.filter(p => p.mult === 0).reduce((a, p) => a + p.pts, 0),
    picks: [...starters, ...bench]
  };
}

async function getCup(league) {
  const cupLeague = league?.cup_league;
  if (!cupLeague) return { started: false, winner: null };
  try {
    const res = await getJson(`${BASE}/leagues-h2h-matches/league/${cupLeague}/?page=1&event=38`);
    const final = (res?.results || []).find(m => m.winner);
    if (!final) return { started: true, winner: null };
    const winner = final.winner === final.entry_1_entry ? final.entry_1_name : final.entry_2_name;
    return { started: true, winner: winner || null };
  } catch (err) {
    console.warn('[CUP] could not read cup league', cupLeague, err.message);
    return { started: true, winner: null };
  }
}

main().catch(err => { console.error(err); process.exit(1); });

