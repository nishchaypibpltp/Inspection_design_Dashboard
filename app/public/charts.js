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
  for (let v = 0; v < max + s - 1e-9; v += s) ticks.push(v);
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
  let mode = 'chart', drawnWidth = 0;
  // Charts are drawn at the card's real width so text keeps one size in every card.
  const render = () => {
    drawnWidth = body.clientWidth;
    body.innerHTML = '';
    if (mode === 'chart') body.appendChild(buildSvg(drawnWidth || 640));
    else body.innerHTML = tableTwin(tableHeaders, tableRows);
    card.querySelector('.tablebtn').textContent = mode === 'chart' ? 'table' : 'chart';
  };
  card.querySelector('.tablebtn').onclick = () => { mode = mode === 'chart' ? 'table' : 'chart'; render(); };
  card.rerender = () => { if (mode === 'chart') render(); };
  render();
  new ResizeObserver(() => { if (mode === 'chart' && Math.abs(body.clientWidth - drawnWidth) > 4) render(); }).observe(body);
  return card;
}

// Stacked daily columns. days: [{day, segs: {key: n}}]; series: [{key,label,color}]
// With visibleDays, only that many columns fit the frame; the rest scroll horizontally
// behind a fixed y-axis, starting at the latest day.
// Vertical zoom lowers the y-axis ceiling; columns taller than it are cut with a ▲ marker.
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6];
function stackedBars(mount, { title, sub, days, series, visibleDays }) {
  const H = 280, padL = 40, padB = 26, padT = 22;
  const total = d => series.reduce((a, s) => a + (d.segs[s.key] || 0), 0);
  const max = Math.max(1, ...days.map(total));
  const plotH = H - padT - padB;
  let zoomIdx = 0, scrollPos = null, bar = null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayLabel = day => {
    const t = new Date(`${day}T00:00:00Z`);
    return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
  };

  const buildSvg = width => {
    const W = Math.max(320, Math.round(width));
    const plotW = W - padL - 8;
    const scrolls = visibleDays && days.length > visibleDays;
    const band = plotW / Math.max(scrolls ? visibleDays : days.length, 1);
    const innerW = band * days.length;
    const bw = Math.min(scrolls ? 36 : 24, band * 0.6);
    // A "Tue 29 Sep" label needs ~70px; label every n-th column, anchored on the latest day.
    const labelEvery = Math.max(1, Math.ceil(70 / band));
    const ticks = niceTicks(max / ZOOM_LEVELS[zoomIdx]);
    const yMax = ticks[ticks.length - 1];

    const axis = svgEl(padL, H);
    axis.setAttribute('width', padL);
    axis.style.flex = '0 0 auto';
    const svg = svgEl(innerW, H);
    svg.setAttribute('width', innerW);
    for (const t of ticks) {
      const y = padT + plotH - (t / yMax) * plotH;
      svg.appendChild(el('line', { x1: 0, x2: innerW, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lbl = el('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end' });
      lbl.textContent = t.toLocaleString(); axis.appendChild(lbl);
    }
    days.forEach((d, i) => {
      const cx = i * band + (band - bw) / 2;
      let yCur = padT + plotH;
      let firstDrawn = false;
      const clipped = total(d) > yMax;
      for (const s of series) {
        const v = d.segs[s.key] || 0;
        if (!v || yCur <= padT) continue;
        const gap = firstDrawn ? 2 : 0;         // 2px surface gap between touching segments
        const yTop = Math.max(yCur - (v / yMax) * plotH, padT);
        const segH = Math.max(yCur - yTop - gap, 0.5);
        const isTop = !clipped && s === [...series].reverse().find(ss => d.segs[ss.key]);
        const path = isTop ? barPath(cx, yTop, bw, segH) : `M${cx},${yTop} h${bw} v${segH} h${-bw} z`;
        svg.appendChild(el('path', { d: path, fill: s.color }));
        yCur = yTop;
        firstDrawn = true;
      }
      if (clipped) {
        // zigzag break across the cut column
        svg.appendChild(el('path', {
          d: `M${cx - 2},${padT + 7} l${(bw + 4) / 4},-4 l${(bw + 4) / 4},4 l${(bw + 4) / 4},-4 l${(bw + 4) / 4},4`,
          fill: 'none', stroke: 'var(--surface)', 'stroke-width': 2.5,
        }));
      }
      if ((scrolls || clipped) && total(d)) {
        const tl = el('text', { x: cx + bw / 2, y: yCur - 5, 'text-anchor': 'middle' });
        tl.style.fill = clipped ? 'var(--ink)' : 'var(--ink-2)';
        if (clipped) tl.style.fontWeight = '650';
        tl.textContent = clipped ? `▲ ${total(d)}` : total(d); svg.appendChild(tl);
      }
      // whole-column hit target — one tooltip, every series
      const hit = el('rect', { x: i * band, y: 0, width: band, height: H, fill: 'transparent' });
      hit.addEventListener('pointermove', ev => {
        const rows = series.filter(s => d.segs[s.key])
          .map(s => `<div class="k"><span class="lk" style="background:${s.color}"></span><span class="v">${d.segs[s.key]}</span>&nbsp;${esc(s.label)}</div>`).join('');
        showTip(`<div class="v">${esc(dayLabel(d.day))} · ${total(d)} sessions</div>${rows || 'no sessions'}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', hideTip);
      svg.appendChild(hit);
      if ((days.length - 1 - i) % labelEvery === 0) {
        const dl = el('text', { x: i * band + band / 2, y: H - 8, 'text-anchor': 'middle' });
        dl.textContent = scrolls ? dayLabel(d.day) : d.day.slice(5); svg.appendChild(dl);
      }
    });
    svg.appendChild(el('line', { x1: 0, x2: innerW, y1: padT + plotH, y2: padT + plotH, stroke: 'var(--baseline)', 'stroke-width': 1 }));

    const wrap = document.createElement('div');
    wrap.className = 'hscroll-chart';
    const scroller = document.createElement('div');
    scroller.className = 'hscroll';
    scroller.appendChild(svg);
    wrap.append(axis, scroller);
    scroller.addEventListener('scroll', () => { hideTip(); scrollPos = scroller.scrollLeft; });
    requestAnimationFrame(() => { scroller.scrollLeft = scrollPos ?? scroller.scrollWidth; });
    // Trackpad pinch arrives as ctrl+wheel; ⌘/Ctrl + scroll does the same with a mouse.
    let acc = 0;
    wrap.addEventListener('wheel', ev => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      acc += ev.deltaY;
      if (Math.abs(acc) < 40) return;
      setZoom(zoomIdx + (acc < 0 ? 1 : -1));
      acc = 0;
    }, { passive: false });
    updateZoomUi();
    return wrap;
  };
  const card = chartCard(mount, {
    title, sub, buildSvg,
    tableHeaders: ['Day', ...series.map(s => s.label)],
    tableRows: days.map(d => [d.day, ...series.map(s => d.segs[s.key] || 0)]),
    legend: legendHtml(series),
  });

  bar = document.createElement('div');
  bar.className = 'chart-zoom';
  bar.innerHTML = `<span class="hint">Pinch or ⌘/Ctrl + scroll over the chart to zoom</span>
    <button data-z="-1" aria-label="Zoom out">−</button><span class="level"></span>
    <button data-z="1" aria-label="Zoom in">+</button><button data-z="0" class="reset">Reset</button>`;
  card.querySelector('.body').before(bar);
  bar.querySelectorAll('button').forEach(b => b.onclick = () =>
    setZoom(b.dataset.z === '0' ? 0 : zoomIdx + Number(b.dataset.z)));
  function setZoom(i) {
    i = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i));
    if (i === zoomIdx) return;
    zoomIdx = i;
    hideTip();
    card.rerender();
  }
  function updateZoomUi() {
    if (!bar?.isConnected) return;
    bar.querySelector('.level').textContent = `${ZOOM_LEVELS[zoomIdx]}×`;
    bar.querySelector('[data-z="-1"]').disabled = zoomIdx === 0;
    bar.querySelector('[data-z="1"]').disabled = zoomIdx === ZOOM_LEVELS.length - 1;
    bar.querySelector('.reset').disabled = zoomIdx === 0;
  }
  updateZoomUi();
  return card;
}

// Horizontal bars, one series (slot 1). rows: [{label, value, extra, note}] — extra is shown in brackets after the value.
function hbars(mount, { title, sub, rows, unit = '', color = 'var(--s1)', maxBars = 16 }) {
  const shown = rows.slice(0, maxBars);
  const rowH = 26, padL = 190, padT = 6;
  const H = padT + shown.length * rowH + 10;
  const max = Math.max(1e-9, ...shown.map(r => Number(r.value)));
  const valueRoom = shown.some(r => r.extra) ? 110 : 70;
  const valueText = r => `${Number(r.value).toLocaleString()}${unit}${r.extra ? ` (${r.extra})` : ''}`;

  const buildSvg = width => {
    const W = Math.max(320, Math.round(width));
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
