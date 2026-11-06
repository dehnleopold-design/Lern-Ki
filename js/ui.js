// Kleine UI-Helfer: Elemente bauen, sicheres Markdown, Maskottchen, Icons, Hinweise.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Wie el.append(), ignoriert aber null/false/undefined.
export function add(el, ...children) {
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Markdown für Lernzettel & Feedback. Alles wird vorher escaped (kein HTML von der KI möglich).
// Unterstützt: ## Abschnitte, ### / #### Unterüberschriften, **fett**, *kursiv*, `code`,
// Listen (2 Ebenen), Tabellen (| a | b |), Trennlinie (---),
// Kästen:  > [!KEY] Label   (Typen: KEY, INFO, TIP, WARN, EXAMPLE)
// Spalten: :::cols (oder :::cards) … ---col--- … :::
const CALLOUT_DEFAULT = { KEY: 'Merke', INFO: 'Info', TIP: 'Tipp', WARN: 'Achtung', EXAMPLE: 'Beispiel' };

function inline(t) {
  return t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?)])/g, '$1<em>$2</em>');
}

const LIST_RE = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;

function renderList(lines) {
  // lines: [{indent, ordered, text}]
  let html = '';
  let i = 0;
  const build = (level) => {
    const ordered = lines[i].ordered;
    let out = ordered ? '<ol>' : '<ul>';
    while (i < lines.length && lines[i].level === level) {
      let li = `<li>${inline(lines[i].text)}`;
      i++;
      if (i < lines.length && lines[i].level > level) li += build(lines[i].level);
      out += `${li}</li>`;
    }
    return out + (ordered ? '</ol>' : '</ul>');
  };
  while (i < lines.length) html += build(lines[i].level);
  return html;
}

function renderTable(rows) {
  const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const isSep = (r) => /^\s*\|?\s*:?-{2,}/.test(r) && /^[\s|:-]+$/.test(r);
  let head = null;
  let body = rows;
  if (rows.length > 1 && isSep(rows[1])) { head = cells(rows[0]); body = rows.slice(2); }
  body = body.filter((r) => !isSep(r));
  return `<div class="tbl-wrap"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    let m;
    if (!t) { i++; continue; }
    if ((m = t.match(/^:::\s*(cols|cards)\s*$/))) {
      const kind = m[1];
      const cols = [[]];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') {
        if (/^-{3}\s*col\s*-{3}$/i.test(lines[i].trim())) cols.push([]); else cols[cols.length - 1].push(lines[i]);
        i++;
      }
      i++;
      out.push(`<div class="cols ${kind}">${cols.map((c, ci) => `<div class="col col-${ci}">${renderBlocks(c)}</div>`).join('')}</div>`);
      continue;
    }
    if (/^&gt;/.test(t)) {
      const inner = [];
      // ein neuer [!TYP]-Marker beginnt einen neuen Kasten
      while (i < lines.length && /^\s*&gt;/.test(lines[i]) && !(inner.length && /^\s*&gt;\s?\[!\w+\]/.test(lines[i]))) { inner.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
      let type = null, label = '';
      if (inner.length && (m = inner[0].match(/^\[!(\w+)\]\s*(.*)$/))) {
        type = m[1].toUpperCase();
        label = m[2] || CALLOUT_DEFAULT[type] || '';
        inner.shift();
      }
      if (!type) { out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`); continue; }
      // "Label: Text" in der ersten Zeile → Label als Marke, Rest als Text
      out.push(`<div class="callout c-${type.toLowerCase()}">${label ? `<span class="c-label">${inline(label)}</span>` : ''}${renderBlocks(inner)}</div>`);
      continue;
    }
    if (/^\|/.test(t)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      out.push(renderTable(rows));
      continue;
    }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      const lvl = m[1].length;
      const tag = lvl <= 2 ? 'h2' : lvl === 3 ? 'h3' : 'h4';
      out.push(`<${tag}>${inline(m[2])}</${tag}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { out.push('<hr>'); i++; continue; }
    if (LIST_RE.test(line)) {
      const items = [];
      const base = line.match(LIST_RE)[1].length;
      while (i < lines.length && (m = lines[i].match(LIST_RE))) {
        items.push({ level: m[1].length > base + 1 ? 1 : 0, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      if (items[0].level) items.forEach((x) => { x.level = 0; });
      out.push(renderList(items));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|:::|\||&gt;|-{3,}$)/.test(lines[i].trim()) && !LIST_RE.test(lines[i])) { para.push(lines[i].trim()); i++; }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }
  return out.join('');
}

export function md(src) {
  return renderBlocks(esc(src || '').split(/\r?\n/));
}

export const mdEl = (text, cls = 'md') => h('div', { class: cls, html: md(text) });

// Eigenes Maskottchen "Kiri": runder Mint-Kopf mit Spross.
export function mascot(size = 88, mood = 'normal') {
  const eyes = mood === 'think'
    ? '<ellipse cx="38" cy="50" rx="7" ry="4" fill="#120c22"/><ellipse cx="62" cy="50" rx="7" ry="4" fill="#120c22"/>'
    : `<ellipse cx="38" cy="50" rx="9" ry="11" fill="#fff"/><ellipse cx="62" cy="50" rx="9" ry="11" fill="#fff"/>
       <circle cx="${mood === 'side' ? 41 : 39}" cy="52" r="5.5" fill="#120c22"/><circle cx="${mood === 'side' ? 65 : 63}" cy="52" r="5.5" fill="#120c22"/>`;
  return h('div', {
    class: 'mascot',
    style: { width: `${size}px`, height: `${size}px` },
    html: `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <path d="M50 22 C50 12 56 6 66 6 C64 14 58 20 50 22Z" fill="#e9d5ff"/>
      <path d="M50 24 C49 16 44 11 36 11 C38 18 43 22 50 24Z" fill="#c4b5fd"/>
      <rect x="48" y="18" width="4" height="10" rx="2" fill="#c4b5fd"/>
      <circle cx="50" cy="58" r="34" fill="#9d7bff"/>
      <ellipse cx="50" cy="80" rx="22" ry="8" fill="#7c5ce6" opacity=".6"/>
      ${eyes}
      <path d="M43 70 Q50 75 57 70" stroke="#120c22" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  });
}

export function speech(text, mood) {
  return h('div', { class: 'speech-row' }, mascot(80, mood), h('div', { class: 'speech' }, text));
}

// Icons: Lucide (https://lucide.dev), ISC-Lizenz – Copyright (c) Lucide Contributors.
const I = {
  back: "<path d=\"m15 18-6-6 6-6\" />",
  close: "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  plus: "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
  chev: "<path d=\"m9 18 6-6-6-6\" />",
  updown: "<path d=\"m7 15 5 5 5-5\" /> <path d=\"m7 9 5-5 5 5\" />",
  book: "<path d=\"M12 7v14\" /> <path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\" />",
  pencil: "<path d=\"M12 20h9\" /> <path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" />",
  bulb: "<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\" /> <path d=\"M9 18h6\" /> <path d=\"M10 22h4\" />",
  exam: "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /> <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /> <path d=\"M12 11h4\" /> <path d=\"M12 16h4\" /> <path d=\"M8 11h.01\" /> <path d=\"M8 16h.01\" />",
  check: "<path d=\"M20 6 9 17l-5-5\" />",
  chat: "<path d=\"M7.9 20A9 9 0 1 0 4 16.1L2 22Z\" />",
  target: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <circle cx=\"12\" cy=\"12\" r=\"6\" /> <circle cx=\"12\" cy=\"12\" r=\"2\" />",
  folder: "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
  gear: "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  camera: "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\" /> <circle cx=\"12\" cy=\"13\" r=\"3\" />",
  trash: "<path d=\"M3 6h18\" /> <path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /> <path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /> <line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /> <line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />",
  send: "<path d=\"M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z\" /> <path d=\"M6 12h16\" />",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <polyline points=\"12 6 12 12 16 14\" />",
  file: "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\" /> <path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />",
  refresh: "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" /> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /> <path d=\"M8 16H3v5\" />",
  quiz: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /> <path d=\"M12 17h.01\" />",
  skip: "<polygon points=\"5 4 15 12 5 20 5 4\" /> <line x1=\"19\" x2=\"19\" y1=\"5\" y2=\"19\" />",
  download: "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <polyline points=\"7 10 12 15 17 10\" /> <line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />",
  flag: "<path d=\"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z\" /> <line x1=\"4\" x2=\"4\" y1=\"22\" y2=\"15\" />",
  route: "<circle cx=\"6\" cy=\"19\" r=\"3\" /> <path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\" /> <circle cx=\"18\" cy=\"5\" r=\"3\" />",
  sparkles: "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\" /> <path d=\"M20 3v4\" /> <path d=\"M22 5h-4\" /> <path d=\"M4 17v2\" /> <path d=\"M5 18H3\" />",
  library: "<path d=\"m16 6 4 14\" /> <path d=\"M12 6v14\" /> <path d=\"M8 8v12\" /> <path d=\"M4 4v16\" />",
  user: "<circle cx=\"12\" cy=\"8\" r=\"5\" /> <path d=\"M20 21a8 8 0 0 0-16 0\" />",
  key: "<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" /> <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
  video: "<path d=\"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z\" /> <path d=\"m6.2 5.3 3.1 3.9\" /> <path d=\"m12.4 3.4 3.1 4\" /> <path d=\"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\" />",
  save: "<path d=\"M12 2v8\" /> <path d=\"m16 6-4 4-4-4\" /> <rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" /> <path d=\"M6 18h.01\" /> <path d=\"M10 18h.01\" />",
  info: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 16v-4\" /> <path d=\"M12 8h.01\" />",
  more: "<circle cx=\"12\" cy=\"12\" r=\"1\" /> <circle cx=\"19\" cy=\"12\" r=\"1\" /> <circle cx=\"5\" cy=\"12\" r=\"1\" />",
  dots: "<circle cx=\"12\" cy=\"12\" r=\"1\" /> <circle cx=\"12\" cy=\"5\" r=\"1\" /> <circle cx=\"12\" cy=\"19\" r=\"1\" />",
  play: "<polygon points=\"6 3 20 12 6 21 6 3\" />",
  upload: "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <polyline points=\"17 8 12 3 7 8\" /> <line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\" />",
  image: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
  layers: "<path d=\"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z\" /> <path d=\"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65\" /> <path d=\"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65\" />",
  circle: "<circle cx=\"12\" cy=\"12\" r=\"10\" />",
  checkc: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m9 12 2 2 4-4\" />",
  trophy: "<path d=\"M6 9H4.5a2.5 2.5 0 0 1 0-5H6\" /> <path d=\"M18 9h1.5a2.5 2.5 0 0 0 0-5H18\" /> <path d=\"M4 22h16\" /> <path d=\"M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22\" /> <path d=\"M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22\" /> <path d=\"M18 2H6v7a6 6 0 0 0 12 0V2Z\" />",
  zap: "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\" />",
};

export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = I[name] || '';
  s.classList.add('icon');
  return s;
}

export function toast(msg, kind = 'info') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 3000);
}

export function confirmDialog(text, okLabel = 'OK') {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(false); } },
      h('div', { class: 'dialog' },
        h('p', {}, text),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Abbrechen'),
          h('button', { class: 'btn danger', onclick: () => close(true) }, okLabel))));
    document.body.append(overlay);
  });
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s) => { const d = parseISO(s); return `${WD[d.getDay()]}., ${d.getDate()}. ${MON[d.getMonth()]}`; };
export function relDay(s) {
  const today = parseISO(isoDate(new Date()));
  const diff = Math.round((parseISO(s) - today) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff > 1) return `In ${diff} Tagen`;
  return `Vor ${-diff} Tagen`;
}
