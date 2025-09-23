async function load() {
    const res = await fetch('data.json', { cache: 'no-store' });
    const data = await res.json();
  
    const currentGW = data.currentGW;
    document.querySelector('.meta').innerHTML =
      `GW ${currentGW} • Last update: ${new Date(data.generatedAt).toLocaleString()}`;
  
    const thead = document.getElementById('thead');
    const tbody = document.getElementById('tbody');
  
    // columns: Team | Total | GW1..GW(current) | Latest Transfers
    const columns = [
      { key: 'teamName', label: 'Team' },
      { key: 'total', label: 'Total' },
      ...Array.from({ length: currentGW }, (_, i) => ({ key: `gw_${i+1}`, label: `GW${i+1}` })),
      { key: 'latest', label: 'Latest Transfers' }
    ];
  
    thead.innerHTML = `<tr>${columns.map(c=>`<th data-key="${c.key}">${c.label}</th>`).join('')}</tr>`;
  
    let rows = data.managers.map(m => {
      const row = { teamName: m.teamName, total: m.total, latest: m.latestGwTransfers };
      m.gwPoints.forEach((p, idx) => row[`gw_${idx+1}`] = p);
      return row;
    });
  
    rows.sort((a,b) => (b.total ?? 0) - (a.total ?? 0));
    render(rows, columns);
  
    // click-to-sort
    thead.addEventListener('click', e => {
      const th = e.target.closest('th'); if (!th) return;
      const key = th.dataset.key;
      const numeric = key === 'total' || key.startsWith('gw_');
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      [...thead.querySelectorAll('th')].forEach(h => delete h.dataset.dir);
      th.dataset.dir = dir;
  
      rows.sort((a,b) => {
        const va = a[key], vb = b[key];
        if (numeric) {
          const na = Number.isFinite(va) ? va : -Infinity;
          const nb = Number.isFinite(vb) ? vb : -Infinity;
          return dir === 'asc' ? na - nb : nb - na;
        }
        return dir === 'asc'
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
      render(rows, columns);
    });
  }
  
  function render(rows, columns) {
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = rows.map(r => `
      <tr>
        ${columns.map(c => {
          if (c.key === 'latest') {
            const txt = (r.latest && r.latest.length)
              ? r.latest.map(t => `<span class="badge">in: ${t.in.name}</span><span class="badge">out: ${t.out.name}</span>`).join(' ')
              : '<span class="badge">—</span>';
            return `<td class="transfers">${txt}</td>`;
          }
          const v = r[c.key];
          return `<td>${v ?? ''}</td>`;
        }).join('')}
      </tr>
    `).join('');
  }
  
  load().catch(err => {
    console.error(err);
    document.getElementById('tbody').innerHTML = `<tr><td>Error loading data</td></tr>`;
  });