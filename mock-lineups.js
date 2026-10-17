// MOCK lineups for previewing the Kadro column before the build fetches real picks.
// Loaded only when the page is opened with ?mock (e.g. index.html?mock). Safe to delete later.
//
// Shape matches what scripts/build.mjs will write per manager as `lineup`:
// {
//   formation: '3-4-3',
//   points: 64,            // GW points incl. captain multiplier, before hits
//   benchPoints: 8,
//   picks: [               // 11 starters (GKP, DEF…, MID…, FWD…) then 4 bench in bench order
//     { name, team, pos: 'GKP'|'DEF'|'MID'|'FWD', pts, mult, c, vc, bench, subIn, subOut }
//   ]
// }

const POOL = {
  GKP: [['Raya', 'ARS'], ['Alisson', 'LIV'], ['Sánchez', 'CHE'], ['Pickford', 'EVE'], ['Verbruggen', 'BHA'], ['Henderson', 'CRY']],
  DEF: [['Gabriel', 'ARS'], ['Saliba', 'ARS'], ['Van Dijk', 'LIV'], ['Gvardiol', 'MCI'], ['Cucurella', 'CHE'], ['Robinson', 'FUL'],
        ['Muñoz', 'CRY'], ['Timber', 'ARS'], ['Konsa', 'AVL'], ['Porro', 'TOT'], ['Lewis-Potter', 'BRE'], ['De Cuyper', 'BHA']],
  MID: [['Salah', 'LIV'], ['Saka', 'ARS'], ['Palmer', 'CHE'], ['Mbeumo', 'MUN'], ['Semenyo', 'BOU'], ['Rice', 'ARS'],
        ['Wirtz', 'LIV'], ['Kudus', 'TOT'], ['Bruno G.', 'NEW'], ['Gakpo', 'LIV'], ['Ndiaye', 'EVE'], ['Szoboszlai', 'LIV']],
  FWD: [['Haaland', 'MCI'], ['Isak', 'LIV'], ['Wood', 'NFO'], ['João Pedro', 'CHE'], ['Watkins', 'AVL'], ['Thiago', 'BRE'], ['Ekitiké', 'LIV']]
};
const FORMATIONS = [[3, 4, 3], [3, 5, 2], [4, 4, 2], [4, 3, 3], [5, 3, 2], [4, 5, 1], [5, 4, 1]];

// Small deterministic RNG so each team keeps the same mock lineup across reloads
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function mockLineup(manager) {
  const rand = rng(Number(manager.entryId) || manager.teamName.length);
  const pickFrom = (pos, n, taken) => {
    const options = POOL[pos].filter(p => !taken.has(p[0]));
    const out = [];
    while (out.length < n && options.length) out.push(options.splice(Math.floor(rand() * options.length), 1)[0]);
    out.forEach(p => taken.add(p[0]));
    return out;
  };
  const pts = () => {
    const r = rand();
    return r < 0.45 ? 2 : r < 0.7 ? 1 + Math.floor(rand() * 4) : r < 0.9 ? 5 + Math.floor(rand() * 5) : 10 + Math.floor(rand() * 9);
  };
  const make = ([name, team], pos, bench) => ({
    name, team, pos, pts: pts(), mult: bench ? 0 : 1, c: false, vc: false, bench, subIn: false, subOut: false
  });

  const [d, m, f] = FORMATIONS[Math.floor(rand() * FORMATIONS.length)];
  const taken = new Set();
  const starters = [
    ...pickFrom('GKP', 1, taken).map(p => make(p, 'GKP', false)),
    ...pickFrom('DEF', d, taken).map(p => make(p, 'DEF', false)),
    ...pickFrom('MID', m, taken).map(p => make(p, 'MID', false)),
    ...pickFrom('FWD', f, taken).map(p => make(p, 'FWD', false))
  ];
  const benchOut = [
    ...pickFrom('DEF', 1, taken).map(p => ['DEF', p]),
    ...pickFrom('MID', 1, taken).map(p => ['MID', p]),
    ...pickFrom('FWD', 1, taken).map(p => ['FWD', p])
  ].sort(() => rand() - 0.5);
  const bench = [
    ...pickFrom('GKP', 1, taken).map(p => make(p, 'GKP', true)),
    ...benchOut.map(([pos, p]) => make(p, pos, true))
  ];

  // Captain = one of the bigger names, vice = another starter
  const outfield = starters.slice(1);
  const cap = outfield[Math.floor(rand() * outfield.length)];
  cap.c = true; cap.mult = manager._chipThisGW === '3xc' ? 3 : 2;
  const vice = outfield.find(p => p !== cap);
  vice.vc = true;

  // ~1 in 3 teams get an auto-sub: a starter who didn't play swaps with the first outfield bench player
  if (rand() < 0.35) {
    const out = outfield.find(p => !p.c && !p.vc);
    const inn = bench.find(p => p.pos !== 'GKP');
    if (out && inn) {
      out.pts = 0; out.subOut = true; out.mult = 0;
      inn.subIn = true; inn.mult = 1;
    }
  }

  // Bench Boost counts the bench
  if (manager._chipThisGW === 'bboost') bench.forEach(p => { p.mult = 1; });

  const picks = [...starters, ...bench];
  const points = picks.reduce((a, p) => a + p.pts * p.mult, 0);
  const benchPoints = bench.filter(p => !p.subIn && manager._chipThisGW !== 'bboost').reduce((a, p) => a + p.pts, 0);
  return { formation: `${d}-${m}-${f}`, points, benchPoints, picks };
}
