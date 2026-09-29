// Minimal SVG charts per the dataviz mark specs: thin marks (≤24px), 4px rounded
// data-ends (square at baseline), 2px surface gaps between touching fills,
// hairline solid grid, per-mark hover tooltips, legend for ≥2 series, table twin.
'use strict';

const tip = document.getElementById('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; // callers build rows via esc() below — never raw data
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 10) + 'px';
  tip.style.top = Math.min(y + 14, innerHeight - r.height - 10) + 'px';
}
function hideTip() { tip.style.display = 'none'; }
function esc(s) { const d = document.createElement('span'); d.textContent = String(s); return d.innerHTML; }

function svgEl(w, h) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', '100%');
  s.style.display = 'block';
  return s;
}
function el(name, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
// Vertical bar with rounded top (data end), square baseline.
function barPath(x, yTop, w, hgt, r = 4) {
  if (hgt <= 0) return '';
  r = Math.min(r, w / 2, hgt);
  return `M${x},${yTop + hgt} v${-(hgt - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${hgt - r} z`;
}
// Horizontal bar with rounded right (data end), square left baseline.
function hbarPath(x, y, wid, h, r = 4) {
  if (wid <= 0) return '';
  r = Math.min(r, h / 2, wid);
  return `M${x},${y} h${wid - r} q${r},0 ${r},${r} v${h - 2 * r} q0,${r} ${-r},${r} h${-(wid - r)} z`;
}
function niceTicks(max, n = 4) {
  if (max <= 0) return [0, 1];
  const step = Math.pow(10, Math.floor(Math.log10(max / n)));
  const mult = [1, 2, 5, 10].find(m => max / (step * m) <= n) || 10;
  const s = step * mult, ticks = [];
  for (let v = 0; v <= max + 1e-9; v += s) ticks.push(v);
  return ticks;
}
function legendHtml(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series.map(s =>
    `<span class="key"><span class="sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}</div>`;
}
function tableTwin(headers, rows) {
  return `<table class="data"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
// Card wrapper with chart/table toggle.
function chartCard(mount, { title, sub, buildSvg, tableHeaders, tableRows, legend }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<button class="tablebtn">table</button><h3>${esc(title)}</h3><div class="sub">${esc(sub || '')}</div><div class="body"></div>${legend || ''}`;
  mount.appendChild(card);
  const body = card.querySelector('.body');
  let mode = 'chart';
  const render = () => {
    body.innerHTML = '';
    if (mode === 'chart') body.appendChild(buildSvg());
    else body.innerHTML = tableTwin(tableHeaders, tableRows);
    card.querySelector('.tablebtn').textContent = mode === 'chart' ? 'table' : 'chart';
  };
  card.querySelector('.tablebtn').onclick = () => { mode = mode === 'chart' ? 'table' : 'chart'; render(); };
  render();
  return card;
}

// Stacked daily columns. days: [{day, segs: {key: n}}]; series: [{key,label,color}]
function stackedBars(mount, { title, sub, days, series }) {
  const W = 640, H = 240, padL = 40, padB = 26, padT = 10;
  const max = Math.max(1, ...days.map(d => series.reduce((a, s) => a + (d.segs[s.key] || 0), 0)));
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1];
  const plotW = W - padL - 8, plotH = H - padT - padB;
  const band = plotW / Math.max(days.length, 1);
  const bw = Math.min(24, band * 0.6);
  // An "MM-DD" label needs ~40 viewBox units; label every n-th column, anchored on the latest day.
  const labelEvery = Math.max(1, Math.ceil(40 / band));

  const buildSvg = () => {
    const svg = svgEl(W, H);
    for (const t of ticks) {
      const y = padT + plotH - (t / yMax) * plotH;
      svg.appendChild(el('line', { x1: padL, x2: W - 8, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lbl = el('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end' });
      lbl.textContent = t.toLocaleString(); svg.appendChild(lbl);
    }
    days.forEach((d, i) => {
      const cx = padL + i * band + (band - bw) / 2;
      let yCur = padT + plotH;
      let firstDrawn = false;
      for (const s of series) {
        const v = d.segs[s.key] || 0;
        if (!v) continue;
        const hgt = (v / yMax) * plotH;
        const gap = firstDrawn ? 2 : 0;         // 2px surface gap between touching segments
        const segH = Math.max(hgt - gap, 0.5);
        const yTop = yCur - hgt;
        const isTop = s === [...series].reverse().find(ss => d.segs[ss.key]);
        const path = isTop ? barPath(cx, yTop, bw, segH) : `M${cx},${yTop} h${bw} v${segH} h${-bw} z`;
        svg.appendChild(el('path', { d: path, fill: s.color }));
        yCur = yTop;
        firstDrawn = true;
      }
      // whole-column hit target — one tooltip, every series
      const hit = el('rect', { x: padL + i * band, y: padT, width: band, height: plotH + padB, fill: 'transparent' });
      hit.addEventListener('pointermove', ev => {
        const rows = series.filter(s => d.segs[s.key])
          .map(s => `<div class="k"><span class="lk" style="background:${s.color}"></span><span class="v">${d.segs[s.key]}</span>&nbsp;${esc(s.label)}</div>`).join('');
        showTip(`<div class="v">${esc(d.day)}</div>${rows || 'no sessions'}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', hideTip);
      svg.appendChild(hit);
      if ((days.length - 1 - i) % labelEvery === 0) {
        const dl = el('text', { x: padL + i * band + band / 2, y: H - 8, 'text-anchor': 'middle' });
        dl.textContent = d.day.slice(5); svg.appendChild(dl);
      }
    });
    svg.appendChild(el('line', { x1: padL, x2: W - 8, y1: padT + plotH, y2: padT + plotH, stroke: 'var(--baseline)', 'stroke-width': 1 }));
    return svg;
  };
  return chartCard(mount, {
    title, sub, buildSvg,
    tableHeaders: ['Day', ...series.map(s => s.label)],
    tableRows: days.map(d => [d.day, ...series.map(s => d.segs[s.key] || 0)]),
    legend: legendHtml(series),
  });
}

// Horizontal bars, one series (slot 1). rows: [{label, value, extra, note}] — extra is shown in brackets after the value.
function hbars(mount, { title, sub, rows, unit = '', color = 'var(--s1)', maxBars = 16 }) {
  const shown = rows.slice(0, maxBars);
  const W = 640, rowH = 26, padL = 190, padT = 6;
  const H = padT + shown.length * rowH + 10;
  const max = Math.max(1e-9, ...shown.map(r => Number(r.value)));
  const valueRoom = shown.some(r => r.extra) ? 110 : 70;
  const valueText = r => `${Number(r.value).toLocaleString()}${unit}${r.extra ? ` (${r.extra})` : ''}`;

  const buildSvg = () => {
    const svg = svgEl(W, H);
    shown.forEach((r, i) => {
      const y = padT + i * rowH;
      const wid = (Number(r.value) / max) * (W - padL - valueRoom);
      const lbl = el('text', { x: padL - 8, y: y + rowH / 2 + 3, 'text-anchor': 'end' });
      lbl.textContent = r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label;
      lbl.style.fill = 'var(--ink-2)';
      svg.appendChild(lbl);
      svg.appendChild(el('path', { d: hbarPath(padL, y + (rowH - 16) / 2, Math.max(wid, 1), 16), fill: color }));
      const val = el('text', { x: padL + Math.max(wid, 1) + 6, y: y + rowH / 2 + 3 });
      val.textContent = valueText(r);
      val.style.fill = 'var(--ink)';
      svg.appendChild(val);
      const hit = el('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' });
      hit.addEventListener('pointermove', ev =>
        showTip(`<div class="v">${esc(valueText(r))}</div><div class="k">${esc(r.label)}</div>${r.note ? `<div class="k">${esc(r.note)}</div>` : ''}`, ev.clientX, ev.clientY));
      hit.addEventListener('pointerleave', hideTip);
      svg.appendChild(hit);
    });
    svg.appendChild(el('line', { x1: padL, x2: padL, y1: padT, y2: H - 8, stroke: 'var(--baseline)', 'stroke-width': 1 }));
    return svg;
  };
  return chartCard(mount, {
    title, sub, buildSvg,
    tableHeaders: ['', `Value${unit ? ` (${unit.trim()})` : ''}`, ''],
    tableRows: rows.map(r => [r.label, r.extra ? valueText(r) : r.value, r.note || '']),
    legend: '',
  });
}

window.charts = { stackedBars, hbars, esc, showTip, hideTip };
