// Welche Jelly läuft gerade? Die normale (/Lern-Ki/) oder Jelly Developer (/Lern-Ki/dev/).
// Beide haben exakt denselben Code – nur diese Datei schaut auf die Adresse.
// Developer hat eigene Daten: lokal (Präfix, siehe dev/devshim.js) und in der Cloud (users/{uid}/dev_…).

export const DEV = typeof location !== 'undefined' && /\/dev\//.test(location.pathname);
// Gemeinsamer Ordner für große Dateien (Schriften, PDF-Bibliotheken, Offline-KI) – liegt nur einmal auf dem Server
export const ASSETS = new URL(DEV ? '../../assets/' : '../assets/', import.meta.url).href;
// Cloud-Ordner: in Developer getrennt, damit Tests nie den echten Stand überschreiben
export const cloudName = (name) => (DEV ? `dev_${name}` : name);
