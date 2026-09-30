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
// Vertical zoom stretches columns taller inside the same frame; the frame then scrolls
// vertically too. The y-axis (left) and day labels (bottom) stay pinned while scrolling.
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6];
function stackedBars(mount, { title, sub, days, series, visibleDays }) {
  const H = 290, padL = 40, padB = 42, padT = 22;
  const total = d => series.reduce((a, s) => a + (d.segs[s.key] || 0), 0);
  const max = Math.max(1, ...days.map(total));
  const plotH = H - padT - padB;
  // Scroll position is kept as distance from the latest day / the baseline, so zoom and
  // resize keep the same part of the chart in view.
  let zoomIdx = 0, fromRight = 0, fromBottom = 0, bar = null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayLabel = day => {
    const t = new Date(`${day}T00:00:00Z`);
    return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
  };
  const sized = (w, h) => { const s = svgEl(w, h); s.setAttribute('width', w); s.setAttribute('height', h); return s; };

  const buildSvg = width => {
    const zoom = ZOOM_LEVELS[zoomIdx];
    const W = Math.max(320, Math.round(width));
    const plotW = W - padL - 8;
    const scrolls = visibleDays && days.length > visibleDays;
    const band = plotW / Math.max(scrolls ? visibleDays : days.length, 1);
    const innerW = band * days.length;
    const bw = Math.min(scrolls ? 36 : 24, band * 0.6);
    // A "Tue 29 Sep" label needs ~70px; label every n-th column, anchored on the latest day.
    const labelEvery = Math.max(1, Math.ceil(70 / band));
    const fullH = plotH * zoom;
    const ticks = niceTicks(max, Math.round(4 * zoom));   // denser gridlines as the scale stretches
    const yMax = ticks[ticks.length - 1];
    const barsH = padT + fullH;
    const yOf = v => padT + fullH - (v / yMax) * fullH;

    const axis = sized(padL, barsH);
    axis.classList.add('y-axis');
    const svg = sized(innerW, barsH);
    for (const t of ticks) {
      const y = yOf(t);
      svg.appendChild(el('line', { x1: 0, x2: innerW, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lbl = el('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end' });
      lbl.textContent = t.toLocaleString(); axis.appendChild(lbl);
    }
    const xl = sized(innerW, padB);
    xl.classList.add('x-axis');
    // Per-day marker in the pinned label row: ▼ when the whole column is below the
    // visible frame, ▲ when it continues above it. Updated on scroll.
    const markers = [];
    days.forEach((d, i) => {
      if (total(d)) {
        const mk = el('text', { x: i * band + band / 2, y: 13, 'text-anchor': 'middle', class: 'offview' });
        xl.appendChild(mk);
        markers.push({ mk, top: yOf(total(d)), n: total(d) });
      }
      const cx = i * band + (band - bw) / 2;
      let yCur = yOf(0);
      let firstDrawn = false;
      const top = [...series].reverse().find(ss => d.segs[ss.key]);
      for (const s of series) {
        const v = d.segs[s.key] || 0;
        if (!v) continue;
        const gap = firstDrawn ? 2 : 0;         // 2px surface gap between touching segments
        const yTop = yCur - (v / yMax) * fullH;
        const segH = Math.max(yCur - yTop - gap, 0.5);
        const path = s === top ? barPath(cx, yTop, bw, segH) : `M${cx},${yTop} h${bw} v${segH} h${-bw} z`;
        svg.appendChild(el('path', { d: path, fill: s.color }));
        yCur = yTop;
        firstDrawn = true;
      }
      if ((scrolls || zoom > 1) && total(d)) {
        const tl = el('text', { x: cx + bw / 2, y: yCur - 5, 'text-anchor': 'middle' });
        tl.style.fill = 'var(--ink-2)';
        tl.textContent = total(d); svg.appendChild(tl);
      }
      // whole-column hit target — one tooltip, every series
      const hit = el('rect', { x: i * band, y: 0, width: band, height: barsH, fill: 'transparent' });
      hit.addEventListener('pointermove', ev => {
        const rows = series.filter(s => d.segs[s.key])
          .map(s => `<div class="k"><span class="lk" style="background:${s.color}"></span><span class="v">${d.segs[s.key]}</span>&nbsp;${esc(s.label)}</div>`).join('');
        showTip(`<div class="v">${esc(dayLabel(d.day))} · ${total(d)} sessions</div>${rows || 'no sessions'}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', hideTip);
      svg.appendChild(hit);
      if ((days.length - 1 - i) % labelEvery === 0) {
        const dl = el('text', { x: i * band + band / 2, y: padB - 7, 'text-anchor': 'middle' });
        dl.textContent = scrolls ? dayLabel(d.day) : d.day.slice(5); xl.appendChild(dl);
      }
    });
    svg.appendChild(el('line', { x1: 0, x2: innerW, y1: yOf(0), y2: yOf(0), stroke: 'var(--baseline)', 'stroke-width': 1 }));

    const corner = document.createElement('div');
    corner.className = 'corner';
    const grid = document.createElement('div');
    grid.className = 'chart-grid';
    grid.style.gridTemplateColumns = `${padL}px ${innerW}px`;
    grid.append(axis, svg, corner, xl);
    const scroller = document.createElement('div');
    scroller.className = 'chart-scroll';
    scroller.style.maxHeight = `${H + 10}px`;   // frame + room for the horizontal scrollbar
    scroller.appendChild(grid);

    let restored = false, pending = false;
    const updateMarkers = () => {
      pending = false;
      const visTop = scroller.scrollTop, visBottom = scroller.scrollTop + scroller.clientHeight - padB;
      let below = 0;
      for (const m of markers) {
        const state = m.top >= visBottom - 2 ? 'below' : m.top < visTop ? 'above' : '';
        if (state === 'below') below++;
        m.mk.textContent = state === 'below' ? `▼ ${m.n}` : state === 'above' ? `▲ ${m.n}` : '';
        m.mk.setAttribute('class', `offview ${state}`);
      }
      if (bar) bar.querySelector('.to-base').hidden = !below;
    };
    scroller.addEventListener('scroll', () => {
      hideTip();
      if (!pending) { pending = true; requestAnimationFrame(updateMarkers); }
      if (!restored || !scroller.isConnected) return;
      fromRight = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
      fromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    }, { passive: true });
    const restore = () => {
      if (!scroller.isConnected) return requestAnimationFrame(restore);
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth - fromRight;
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - fromBottom;
      updateMarkers();
      requestAnimationFrame(() => { restored = true; });
    };
    requestAnimationFrame(restore);
    // Trackpad pinch arrives as ctrl+wheel; ⌘/Ctrl + scroll does the same with a mouse.
    let acc = 0;
    scroller.addEventListener('wheel', ev => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      acc += ev.deltaY;
      if (Math.abs(acc) < 40) return;
      setZoom(zoomIdx + (acc < 0 ? 1 : -1));
      acc = 0;
    }, { passive: false });
    updateZoomUi();
    return scroller;
  };
  const card = chartCard(mount, {
    title, sub, buildSvg,
    tableHeaders: ['Day', ...series.map(s => s.label)],
    tableRows: days.map(d => [d.day, ...series.map(s => d.segs[s.key] || 0)]),
    legend: legendHtml(series),
  });

  bar = document.createElement('div');
  bar.className = 'chart-zoom';
  bar.innerHTML = `<span class="hint"></span>
    <button data-z="-1" aria-label="Zoom out">−</button><span class="level"></span>
    <button data-z="1" aria-label="Zoom in">+</button><button data-z="0" class="reset">Reset</button>`;
  bar.querySelector('.hint').insertAdjacentHTML('afterend', '<button class="to-base" hidden>▼ Back to baseline</button>');
  card.querySelector('.body').before(bar);
  bar.querySelectorAll('button[data-z]').forEach(b => b.onclick = () =>
    setZoom(b.dataset.z === '0' ? 0 : zoomIdx + Number(b.dataset.z)));
  bar.querySelector('.to-base').onclick = () => {
    const sc = card.querySelector('.chart-scroll');
    sc?.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  };
  function setZoom(i) {
    i = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i));
    if (i === zoomIdx) return;
    fromBottom *= ZOOM_LEVELS[i] / ZOOM_LEVELS[zoomIdx];
    zoomIdx = i;
    hideTip();
    card.rerender();
  }
  function updateZoomUi() {
    if (!bar?.isConnected) return;
    bar.querySelector('.level').textContent = `${ZOOM_LEVELS[zoomIdx]}×`;
    bar.querySelector('.hint').textContent = zoomIdx
      ? 'Scroll inside the chart to move up or down · ▼ / ▲ under a day = its bar is below / above the view'
      : 'Pinch or ⌘/Ctrl + scroll over the chart to zoom';
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
