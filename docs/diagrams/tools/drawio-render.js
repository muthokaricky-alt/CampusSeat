// Minimal offline renderer for the shapes CampusSeat's draw.io files use. Runs in the browser: window.renderDrawio(xmlText) -> SVG string.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = 'Helvetica, Arial, sans-serif';
  const ctx = document.createElement('canvas').getContext('2d');
  const measure = (t, size, bold) => { ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; return ctx.measureText(t).width; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const decode = (s) => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };
  const lines = (v) => decode(v || '').split(/<br\s*\/?>/i).map((l) => decode(l.replace(/<[^>]+>/g, '')));
  function wrap(text, width, size, bold) {
    const out = [];
    for (const para of text) {
      const words = para.split(' '); let cur = '';
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (measure(t, size, bold) > width && cur) { out.push(cur); cur = w; } else cur = t; }
      out.push(cur);
    }
    return out;
  }
  const parseStyle = (s) => { const o = {}; (s || '').split(';').filter(Boolean).forEach((p) => { const i = p.indexOf('='); if (i < 0) o[p] = true; else o[p.slice(0, i)] = p.slice(i + 1); }); return o; };

  window.renderDrawio = function (xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const cells = {}; const order = [];
    for (const c of doc.querySelectorAll('mxCell')) {
      const g = c.querySelector(':scope > mxGeometry');
      const cell = { id: c.getAttribute('id'), parent: c.getAttribute('parent'), value: c.getAttribute('value') || '', style: parseStyle(c.getAttribute('style')),
        vertex: c.getAttribute('vertex') === '1', edge: c.getAttribute('edge') === '1', source: c.getAttribute('source'), target: c.getAttribute('target'), g };
      cells[cell.id] = cell; order.push(cell);
    }
    const num = (g, k, d = 0) => (g && g.getAttribute(k) != null ? Number(g.getAttribute(k)) : d);
    const abs = (cell) => {
      if (!cell || !cell.g || !cell.vertex) return { x: 0, y: 0, w: 0, h: 0 };
      const p = cells[cell.parent] && cells[cell.parent].vertex ? abs(cells[cell.parent]) : { x: 0, y: 0 };
      return { x: p.x + num(cell.g, 'x'), y: p.y + num(cell.g, 'y'), w: num(cell.g, 'width'), h: num(cell.g, 'height') };
    };
    const parts = []; const labels = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, w = 0, h = 0) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
    const textEl = (x, y, t, { size = 12, bold, italic, underline, anchor = 'start', color = '#1a1a1a' } = {}) =>
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${color}"${bold ? ' font-weight="bold"' : ''}${italic ? ' font-style="italic"' : ''}${underline ? ' text-decoration="underline"' : ''} text-anchor="${anchor}">${esc(t)}</text>`;
    const fs = (st) => Number(st.fontSize || 12);
    const fstyle = (st) => { const f = Number(st.fontStyle || 0); return { bold: !!(f & 1), italic: !!(f & 2), underline: !!(f & 4) }; };

    // ---- vertices
    for (const c of order) {
      if (!c.vertex || c.style.edgeLabel) continue;
      const b = abs(c); const st = c.style; const size = fs(st); const f = fstyle(st);
      const stroke = st.strokeColor && st.strokeColor !== 'none' ? st.strokeColor : '#333333';
      if (st.swimlane) {
        const head = Number(st.startSize || 26);
        const hf = st.fillColor && st.fillColor !== 'none' ? st.fillColor : '#e6edf7';
        const bf = st.swimlaneFillColor || '#ffffff';
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${bf}" stroke="${stroke}" stroke-width="1.3"/>`,
          `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${head}" fill="${hf}" stroke="${stroke}" stroke-width="1.3"/>`,
          textEl(b.x + b.w / 2, b.y + head / 2 + size * 0.36, decode(c.value), { size: size + 1, bold: true, anchor: 'middle' }));
        grow(b.x, b.y, b.w, b.h);
      } else if (st.line) {
        parts.push(`<line x1="${b.x}" y1="${b.y + b.h / 2}" x2="${b.x + b.w}" y2="${b.y + b.h / 2}" stroke="${cells[c.parent]?.style.strokeColor || stroke}" stroke-width="1.3"/>`);
      } else if (st.ellipse) {
        const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : '#ffffff';
        parts.push(`<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`);
        const ls = wrap(lines(c.value), b.w - 26, size, f.bold); const lh = size * 1.25;
        ls.forEach((l, i) => parts.push(textEl(b.x + b.w / 2, b.y + b.h / 2 - ((ls.length - 1) * lh) / 2 + i * lh + size * 0.36, l, { size, ...f, anchor: 'middle' })));
        grow(b.x, b.y, b.w, b.h);
      } else if (st.shape === 'umlActor') {
        const cx = b.x + b.w / 2; const r = b.h * 0.13;
        parts.push(`<g fill="none" stroke="${stroke}" stroke-width="1.5"><circle cx="${cx}" cy="${b.y + r}" r="${r}" fill="#fff"/><line x1="${cx}" y1="${b.y + 2 * r}" x2="${cx}" y2="${b.y + b.h * 0.65}"/>`
          + `<line x1="${b.x}" y1="${b.y + b.h * 0.38}" x2="${b.x + b.w}" y2="${b.y + b.h * 0.38}"/><line x1="${cx}" y1="${b.y + b.h * 0.65}" x2="${b.x}" y2="${b.y + b.h}"/><line x1="${cx}" y1="${b.y + b.h * 0.65}" x2="${b.x + b.w}" y2="${b.y + b.h}"/></g>`,
        textEl(cx, b.y + b.h + 16, decode(c.value), { size: size + 1, bold: true, anchor: 'middle' }));
        grow(b.x - 20, b.y, b.w + 40, b.h + 22);
      } else if (st.text) {
        const sl = Number(st.spacingLeft || 0) + 2; const color = st.fontColor || '#1a1a1a';
        const ls = st.whiteSpace === 'wrap' ? wrap(lines(c.value), b.w - sl - 4, size, f.bold) : lines(c.value); const lh = size * 1.35;
        const top = st.verticalAlign === 'top' ? b.y + 4 + size : b.y + b.h / 2 - ((ls.length - 1) * lh) / 2 + size * 0.36;
        const anchor = st.align === 'center' ? 'middle' : 'start'; const x = anchor === 'middle' ? b.x + b.w / 2 : b.x + sl;
        ls.forEach((l, i) => parts.push(textEl(x, top + i * lh, l, { size, ...f, anchor, color })));
        if (!cells[c.parent]?.vertex) grow(b.x, b.y, b.w, b.h);
      } else if (st.rhombus) {
        const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : '#ffffff'; const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        parts.push(`<polygon points="${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`);
        const ls = wrap(lines(c.value), b.w * 0.62, size, f.bold); const lh = size * 1.25;
        ls.forEach((l, i) => parts.push(textEl(cx, cy - ((ls.length - 1) * lh) / 2 + i * lh + size * 0.36, l, { size, ...f, anchor: 'middle' })));
        grow(b.x, b.y, b.w, b.h);
      } else if (st.verticalAlign !== 'top' && c.value) {
        const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : '#ffffff'; const r = st.rounded === '1' ? 12 : 0;
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`);
        const ls = wrap(lines(c.value), b.w - 16, size, f.bold); const lh = size * 1.25;
        ls.forEach((l, i) => parts.push(textEl(b.x + b.w / 2, b.y + b.h / 2 - ((ls.length - 1) * lh) / 2 + i * lh + size * 0.36, l, { size, ...f, anchor: 'middle' })));
        grow(b.x, b.y, b.w, b.h);
      } else {
        const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : 'none';
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
        if (c.value) parts.push(textEl(b.x + b.w / 2, b.y + size + 10, decode(c.value), { size, ...f, anchor: 'middle' }));
        grow(b.x, b.y, b.w, b.h);
      }
    }

    // ---- edges
    const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    function clip(cell, b, from) {
      if (cell.style.shape === 'umlActor') b = { ...b, h: b.h + 24 }; // keep clear of the name under the figure
      const c = center(b); const dx = from.x - c.x; const dy = from.y - c.y;
      if (!dx && !dy) return c;
      if (cell.style.rhombus) { const t = 1 / (Math.abs(dx) / (b.w / 2) + Math.abs(dy) / (b.h / 2)); return { x: c.x + dx * t, y: c.y + dy * t }; }
      if (cell.style.ellipse) { const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2) + (dy * dy) / ((b.h / 2) ** 2)); return { x: c.x + dx * t, y: c.y + dy * t }; }
      const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
      return { x: c.x + dx * t, y: c.y + dy * t };
    }
    const pt = (b, fx, fy) => ({ x: b.x + b.w * fx, y: b.y + b.h * fy });
    function marker(kind, tip, from, fill, stroke) {
      const ang = Math.atan2(tip.y - from.y, tip.x - from.x); const cos = Math.cos(ang), sin = Math.sin(ang);
      const P = (along, across) => ({ x: tip.x - along * cos - across * sin, y: tip.y - along * sin + across * cos });
      const L = (a, b2) => `<line x1="${a.x}" y1="${a.y}" x2="${b2.x}" y2="${b2.y}" stroke="${stroke}" stroke-width="1.5"/>`;
      const poly = (ps, f) => `<polygon points="${ps.map((p) => `${p.x},${p.y}`).join(' ')}" fill="${f}" stroke="${stroke}" stroke-width="1.5"/>`;
      const circ = (along) => { const p = P(along, 0); return `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#fff" stroke="${stroke}" stroke-width="1.5"/>`; };
      switch (kind) {
        case 'block': return { svg: poly([tip, P(14, 7), P(14, -7)], fill ? stroke : '#fff'), back: 14 };
        case 'open': return { svg: L(tip, P(11, 6)) + L(tip, P(11, -6)), back: 0 };
        case 'ERmandOne': return { svg: L(P(8, 7), P(8, -7)) + L(P(13, 7), P(13, -7)), back: 0 };
        case 'ERzeroToMany': return { svg: L(tip, P(13, 0)) + L(P(13, 0), P(0, 8)) + L(P(13, 0), P(0, -8)) + circ(19), back: 0, gap: 24 };
        case 'ERzeroToOne': return { svg: L(P(8, 7), P(8, -7)) + circ(17), back: 0, gap: 22 };
        default: return { svg: '', back: 0 };
      }
    }
    for (const c of order) {
      if (!c.edge) continue;
      const st = c.style; const stroke = st.strokeColor || '#333333';
      const s = cells[c.source]; const t = cells[c.target];
      const way = [...(c.g?.querySelectorAll(':scope > Array > mxPoint') || [])].map((p) => ({ x: num(p, 'x'), y: num(p, 'y') }));
      const sp = c.g?.querySelector(':scope > mxPoint[as=sourcePoint]'); const tp = c.g?.querySelector(':scope > mxPoint[as=targetPoint]');
      const sb = s ? abs(s) : null; const tb = t ? abs(t) : null;
      const firstToward = way[0] || (tb ? center(tb) : { x: num(tp, 'x'), y: num(tp, 'y') });
      const lastFrom = way[way.length - 1] || (sb ? center(sb) : { x: num(sp, 'x'), y: num(sp, 'y') });
      let a = s ? (st.exitX != null ? pt(sb, +st.exitX, +st.exitY) : clip(s, sb, firstToward)) : { x: num(sp, 'x'), y: num(sp, 'y') };
      let z = t ? (st.entryX != null ? pt(tb, +st.entryX, +st.entryY) : clip(t, tb, lastFrom)) : { x: num(tp, 'x'), y: num(tp, 'y') };
      const pts = [a, ...way, z];
      const endKind = st.endArrow || (st.edgeStyle ? 'none' : 'classic'); const startKind = st.startArrow || 'none';
      const em = marker(endKind === 'classic' ? 'block' : endKind, z, pts[pts.length - 2], st.endFill !== '0', stroke);
      const sm = marker(startKind, a, pts[1], st.startFill !== '0', stroke);
      const shorten = (p, q, d) => { const L = Math.hypot(p.x - q.x, p.y - q.y) || 1; return { x: p.x + ((q.x - p.x) * d) / L, y: p.y + ((q.y - p.y) * d) / L }; };
      const drawn = pts.slice(); if (em.back) drawn[drawn.length - 1] = shorten(z, pts[pts.length - 2], em.back);
      parts.push(`<polyline points="${drawn.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.4"${st.dashed ? ' stroke-dasharray="6 4"' : ''}/>`, em.svg, sm.svg);
      pts.forEach((p) => grow(p.x - 10, p.y - 10, 20, 20));
      // label at the middle of the path, and child edge labels at their relative position
      const segs = []; let total = 0; for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(L); total += L; }
      const at = (frac) => { let d = frac * total; for (let i = 0; i < segs.length; i++) { if (d <= segs[i] || i === segs.length - 1) { const r = segs[i] ? d / segs[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * r, y: pts[i].y + (pts[i + 1].y - pts[i].y) * r }; } d -= segs[i]; } return z; };
      const put = (text, p, size, italic, above) => { const w = measure(text, size) + 8; labels.push(`<rect x="${p.x - w / 2}" y="${p.y - size * 0.8 - (above ? 9 : 0)}" width="${w}" height="${size * 1.4}" fill="#fff"/>`, textEl(p.x, p.y + size * 0.36 - (above ? 9 : 0), text, { size, italic, anchor: 'middle', color: '#333' })); };
      if (c.value) put(decode(c.value).replace(/<[^>]+>/g, ''), at(0.5), Number(st.fontSize || 11), !!st.fontSize || true, false);
      for (const ch of order) if (ch.parent === c.id && ch.vertex && ch.style.edgeLabel) {
        const fx = (num(ch.g, 'x') + 1) / 2; put(decode(ch.value), at(Math.min(0.97, Math.max(0.03, fx))), 11, false, true);
      }
    }
    const m = 24; const W = Math.ceil(maxX - minX + 2 * m); const H = Math.ceil(maxY - minY + 2 * m);
    return { w: W, h: H, svg: `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="${minX - m} ${minY - m} ${W} ${H}"><rect x="${minX - m}" y="${minY - m}" width="${W}" height="${H}" fill="#fff"/>${parts.join('')}${labels.join('')}</svg>` };
  };
})();
