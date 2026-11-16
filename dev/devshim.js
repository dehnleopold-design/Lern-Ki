// Jelly Developer läuft auf derselben Adresse wie das echte Jelly und würde sonst denselben Browser-Speicher benutzen.
// Dieses Skript läuft vor allem anderen und gibt Developer einen eigenen Speicher:
//  - localStorage/sessionStorage: alle Schlüssel bekommen das Präfix "jellydev:"
//  - IndexedDB (Stand, Dateien, Anmeldung): alle Datenbanken heißen "dev-…"
// Das echte Jelly wird dadurch nie verändert. window.__realIDB erlaubt nur das Lesen beim Kopieren.
(function () {
  var P = 'jellydev:';
  var S = Storage.prototype;
  var g = S.getItem, s = S.setItem, r = S.removeItem;
  S.getItem = function (k) { return g.call(this, P + k); };
  S.setItem = function (k, v) { return s.call(this, P + k, v); };
  S.removeItem = function (k) { return r.call(this, P + k); };
  S.clear = function () { for (var i = this.length - 1; i >= 0; i--) { var k = this.key(i); if (k && k.indexOf(P) === 0) r.call(this, k); } };

  var idb = window.indexedDB;
  if (!idb) return;
  var open = idb.open.bind(idb), del = idb.deleteDatabase.bind(idb), list = idb.databases ? idb.databases.bind(idb) : null;
  window.__realIDB = { open: function (n) { return open(n); } };
  idb.open = function (n, v) { return v === undefined ? open('dev-' + n) : open('dev-' + n, v); };
  idb.deleteDatabase = function (n) { return del('dev-' + n); };
  if (list) idb.databases = function () {
    return list().then(function (all) {
      return all.filter(function (d) { return d.name && d.name.indexOf('dev-') === 0; }).map(function (d) { return { name: d.name.slice(4), version: d.version }; });
    });
  };
})();
