#!/usr/bin/env python3
"""Jelly Developer verwalten.

  python3 tools/dev.py reset              echtes Jelly → dev/ (Developer neu aufsetzen)
  python3 tools/dev.py promote "2.61 (17.11.)" [--merged]
                                          dev/ → echtes Jelly übertragen (mit neuer Versionsnummer)
  python3 tools/dev.py bump "2.61-dev.2"  nur die Developer-Version erhöhen (Update-Hinweis in Developer)
  python3 tools/dev.py status             zeigt, ob echtes Jelly / Developer seit dem letzten Abgleich geändert wurden

Sicherheitsnetz: dev/BASE merkt sich den Stand beider Seiten beim letzten Abgleich.
- promote bricht ab, wenn das echte Jelly inzwischen direkt geändert wurde (sonst gingen diese Änderungen verloren).
- reset bricht ab, wenn in Developer noch nicht übertragene Änderungen liegen (außer mit --force).
"""
import hashlib, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
BASE = os.path.join(DEV, 'BASE')
CODE = ['js', 'styles.css', 'index.html']  # was zwischen beiden Seiten gleich ist (index.html bis auf Pfade)


def p(*a):
    return os.path.join(ROOT, *a)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def strip_version(rel, text):
    # Die Versionsnummer unterscheidet sich absichtlich – beim Vergleich ignorieren
    if rel.endswith('app.js'):
        text = re.sub(r"const APP_VERSION = '[^']*';", "const APP_VERSION = '';", text)
    return text


def tree_hash(base, normalize_index=None):
    h = hashlib.sha1()
    for item in CODE:
        path = os.path.join(base, item)
        files = []
        if os.path.isdir(path):
            for d, _, fs in os.walk(path):
                files += [os.path.join(d, f) for f in fs]
        elif os.path.exists(path):
            files = [path]
        for f in sorted(files):
            rel = os.path.relpath(f, base)
            text = strip_version(rel, read(f))
            if rel == 'index.html' and normalize_index:
                text = normalize_index(text)
            h.update(rel.encode() + b'\0' + text.encode() + b'\0')
    return h.hexdigest()


def root_hash():
    return tree_hash(ROOT)


def dev_hash():
    return tree_hash(DEV, dev_index_to_root)


# ---------- Umwandlungen echtes Jelly ↔ Developer
def root_index_to_dev(text):
    text = text.replace('href="assets/', 'href="../assets/')
    text = text.replace('<title>Lern-KI</title>', '<title>Jelly Dev</title>')
    text = text.replace('content="Lern-KI"', 'content="Jelly Dev"')
    text = text.replace('<link rel="apple-touch-icon" href="../assets/icon-180.png" />', '<link rel="apple-touch-icon" href="icon-180.png" />')
    text = text.replace('<meta name="theme-color" content="#09080d" />', '<meta name="theme-color" content="#09080d" />\n  <!-- Eigener Speicher für Developer – muss vor allem anderen laufen -->\n  <script src="devshim.js"></script>')
    return text


def dev_index_to_root(text):
    text = text.replace('\n  <!-- Eigener Speicher für Developer – muss vor allem anderen laufen -->\n  <script src="devshim.js"></script>', '')
    text = text.replace('<link rel="apple-touch-icon" href="icon-180.png" />', '<link rel="apple-touch-icon" href="../assets/icon-180.png" />')
    text = text.replace('<title>Jelly Dev</title>', '<title>Lern-KI</title>')
    text = text.replace('content="Jelly Dev"', 'content="Lern-KI"')
    text = text.replace('href="../assets/', 'href="assets/')
    return text


def js_files(base):
    return sorted(f for f in os.listdir(os.path.join(base, 'js')) if f.endswith('.js'))


def dev_sw(version_n):
    shell = ['./', 'index.html', 'devshim.js', 'styles.css', 'manifest.webmanifest', 'icon-180.png', '../assets/icon.svg', '../assets/fonts.css'] + [f'js/{f}' for f in js_files(DEV)]
    return f"""// Service Worker von Jelly Developer (/dev/). Eigener Cache, getrennt vom echten Jelly.
// Wird von tools/dev.py erzeugt – nicht von Hand ändern.
const CACHE = 'lernki-dev-{version_n}';
const SHELL = {json.dumps(shell)};

self.addEventListener('install', (e) => {{
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
}});

self.addEventListener('activate', (e) => {{
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('lernki-dev-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
}});

self.addEventListener('fetch', (e) => {{
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, {{ cache: 'no-cache' }})
      .then((res) => {{ const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }})
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
}});
"""


DEV_MANIFEST = {
    'name': 'Jelly Developer', 'short_name': 'Jelly Dev', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#09080d', 'theme_color': '#09080d', 'lang': 'de',
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
    ],
}


def set_app_version(base, version):
    path = os.path.join(base, 'js', 'app.js')
    text = read(path)
    text, n = re.subn(r"const APP_VERSION = '[^']*';", f"const APP_VERSION = '{version}';", text)
    assert n == 1, 'APP_VERSION nicht gefunden'
    write(path, text)
    write(os.path.join(base, 'version.json'), json.dumps({'version': version}, ensure_ascii=False) + '\n')


def dev_version():
    try:
        return json.loads(read(os.path.join(DEV, 'version.json')))['version']
    except Exception:
        return None


def write_dev_extras():
    n = int(re.search(r"lernki-dev-(\d+)", read(os.path.join(DEV, 'sw.js'))).group(1)) + 1 if os.path.exists(os.path.join(DEV, 'sw.js')) else 1
    write(os.path.join(DEV, 'sw.js'), dev_sw(n))
    write(os.path.join(DEV, 'manifest.webmanifest'), json.dumps(DEV_MANIFEST, ensure_ascii=False, indent=2) + '\n')


def save_base():
    write(BASE, json.dumps({'root': root_hash(), 'dev': dev_hash()}, indent=2) + '\n')


def load_base():
    try:
        return json.loads(read(BASE))
    except Exception:
        return None


def next_dev_version(root_version):
    m = re.match(r'(\d+)\.(\d+)', root_version)
    return f'{m.group(1)}.{int(m.group(2)) + 1}-dev.1' if m else 'dev.1'


# ---------- Befehle
def reset(force=False):
    base = load_base()
    if base and not force and dev_hash() != base['dev']:
        sys.exit('Abbruch: In Developer liegen Änderungen, die noch nicht ins echte Jelly übertragen wurden.\n'
                 'Erst "promote" – oder mit --force verwerfen.')
    shutil.rmtree(os.path.join(DEV, 'js'), ignore_errors=True)
    shutil.copytree(p('js'), os.path.join(DEV, 'js'))
    shutil.copy(p('styles.css'), os.path.join(DEV, 'styles.css'))
    write(os.path.join(DEV, 'index.html'), root_index_to_dev(read(p('index.html'))))
    root_version = json.loads(read(p('version.json')))['version']
    set_app_version(DEV, next_dev_version(root_version))
    write_dev_extras()
    save_base()
    print(f'Developer neu aufgesetzt aus dem echten Jelly {root_version} → {dev_version()}')


def promote(version, merged=False):
    base = load_base()
    if not base:
        sys.exit('Abbruch: dev/BASE fehlt – erst "reset".')
    # --merged: die direkten Änderungen am echten Jelly wurden bereits von Hand in dev/ übernommen
    if root_hash() != base['root'] and not merged:
        sys.exit('Abbruch: Das echte Jelly wurde seit dem letzten Abgleich direkt geändert.\n'
                 'Diese Änderungen erst in dev/ übernehmen (oder bewusst verwerfen), sonst gehen sie verloren.')
    shutil.rmtree(p('js'))
    shutil.copytree(os.path.join(DEV, 'js'), p('js'))
    shutil.copy(os.path.join(DEV, 'styles.css'), p('styles.css'))
    write(p('index.html'), dev_index_to_root(read(os.path.join(DEV, 'index.html'))))
    set_app_version(ROOT, version)
    # Service Worker des echten Jelly: neue Cache-Nummer und alle Module (ohne die Developer-Werkzeuge)
    sw = read(p('sw.js'))
    sw = re.sub(r"lernki-v(\d+)", lambda m: f"lernki-v{int(m.group(1)) + 1}", sw, count=1)
    mods = ', '.join(f"'js/{f}'" for f in js_files(ROOT) if f != 'devtools.js')
    sw = re.sub(r"(const SHELL = \[[^\n]*\n)  [^\n]*\];", lambda m: m.group(1) + f"  {mods}];", sw, count=1)
    write(p('sw.js'), sw)
    save_base()
    print(f'Übertragen: Developer {dev_version()} → echtes Jelly {version}')


def bump(version):
    set_app_version(DEV, version)
    write_dev_extras()
    print(f'Developer-Version: {version}')


def status():
    base = load_base()
    if not base:
        print('Noch kein Abgleich (dev/BASE fehlt).'); return
    print('Echtes Jelly seit Abgleich geändert:', 'ja' if root_hash() != base['root'] else 'nein')
    print('Developer seit Abgleich geändert:   ', 'ja' if dev_hash() != base['dev'] else 'nein')
    print('Developer-Version:', dev_version())


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'reset':
        reset('--force' in a)
    elif a[0] == 'promote' and len(a) > 1:
        promote(a[1], '--merged' in a)
    elif a[0] == 'bump' and len(a) > 1:
        bump(a[1])
    elif a[0] == 'status':
        status()
    else:
        sys.exit(__doc__)
