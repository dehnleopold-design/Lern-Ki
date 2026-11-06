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
    ? '<ellipse cx="38" cy="50" rx="7" ry="4" fill="#0b0e17"/><ellipse cx="62" cy="50" rx="7" ry="4" fill="#0b0e17"/>'
    : `<ellipse cx="38" cy="50" rx="9" ry="11" fill="#fff"/><ellipse cx="62" cy="50" rx="9" ry="11" fill="#fff"/>
       <circle cx="${mood === 'side' ? 41 : 39}" cy="52" r="5.5" fill="#0b0e17"/><circle cx="${mood === 'side' ? 65 : 63}" cy="52" r="5.5" fill="#0b0e17"/>`;
  return h('div', {
    class: 'mascot',
    style: { width: `${size}px`, height: `${size}px` },
    html: `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <path d="M50 22 C50 12 56 6 66 6 C64 14 58 20 50 22Z" fill="#7be0a8"/>
      <path d="M50 24 C49 16 44 11 36 11 C38 18 43 22 50 24Z" fill="#56c98a"/>
      <rect x="48" y="18" width="4" height="10" rx="2" fill="#56c98a"/>
      <circle cx="50" cy="58" r="34" fill="#3dd6b5"/>
      <ellipse cx="50" cy="80" rx="22" ry="8" fill="#2fbf9f" opacity=".6"/>
      ${eyes}
      <path d="M43 70 Q50 75 57 70" stroke="#0b0e17" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  });
}

export function speech(text, mood) {
  return h('div', { class: 'speech-row' }, mascot(80, mood), h('div', { class: 'speech' }, text));
}

const I = {
  back: '<path d="M15 6l-6 6 6 6" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  chev: '<path d="M9 6l6 6-6 6" />',
  updown: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4" />',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16" />',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3 11v2h6v-2a6 6 0 00-3-11z" />',
  exam: '<path d="M7 3h10v18H7zM10 8h4M10 12h4M10 16h2" />',
  check: '<path d="M5 12l5 5 9-10" />',
  chat: '<path d="M4 5h16v11H9l-5 4z" />',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z" />',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />',
  send: '<path d="M4 12l16-8-6 16-2-6z" />',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" />',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4" />',
  refresh: '<path d="M20 11a8 8 0 10-2 6M20 5v6h-6" />',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.2M12 17h.01" />',
  skip: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6" />',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5" />',
};

export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
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
