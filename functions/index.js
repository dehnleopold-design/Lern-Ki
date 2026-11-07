// Jelly im Hintergrund – Firebase Cloud Functions (Rechenzentrum Frankfurt).
// Diese Datei muss nur einmal hochgeladen werden. Die eigentliche Logik (server/worker.mjs und die App-Module)
// wird bei jedem neuen App-Stand von der Website geladen, damit Änderungen ohne neues Deployment wirken.
//
// Auslöser:
//  - lernkiJob:      neuer/aktualisierter Auftrag in users/{uid}/bgjobs
//  - lernkiPresence: die App wurde geschlossen (users/{uid}/bgpresence/app)
//  - lernkiSweep:    alle 10 Minuten, falls etwas liegen geblieben ist

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';

// concurrency 1: Die App-Module halten den Stand global – pro Instanz immer nur ein Konto gleichzeitig.
setGlobalOptions({ region: 'europe-west3', memory: '512MiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 5 });
initializeApp();
const db = getFirestore();

const SITE = 'https://dehnleopold-design.github.io/Lern-Ki/';
const RUN_MS = 470 * 1000; // Puffer bis zum Zeitlimit von 540 s
let loaded = { version: null, mod: null };

async function loadWorker() {
  const res = await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: 'no-store' });
  const version = (await res.json()).version;
  if (loaded.version === version) return loaded.mod;
  const tag = encodeURIComponent(version);
  const dir = `/tmp/lernki/${tag.replace(/[^A-Za-z0-9]/g, '_')}`;
  const files = await (await fetch(`${SITE}server/files.json?v=${tag}`)).json();
  for (const f of files) {
    const r = await fetch(`${SITE}${f}?v=${tag}`);
    if (!r.ok) throw new Error(`Laden fehlgeschlagen: ${f} (${r.status})`);
    const path = `${dir}/${f}`;
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, await r.text());
  }
  await writeFile(`${dir}/package.json`, '{"type":"module"}');
  loaded = { version, mod: await import(`${dir}/server/worker.mjs`) };
  logger.info(`Jelly-Code geladen: ${version}`);
  return loaded.mod;
}

async function worker(started) {
  const mod = await loadWorker();
  return mod.makeWorker(db, { deadline: started + RUN_MS, log: (m) => logger.info(m) });
}

export const lernkiJob = onDocumentWritten('users/{uid}/bgjobs/{key}', async (event) => {
  if (!event.data?.after?.exists) return;
  const w = await worker(Date.now());
  await w.processUser(event.params.uid);
});

export const lernkiPresence = onDocumentWritten('users/{uid}/bgpresence/app', async (event) => {
  const after = event.data?.after?.data();
  if (!after || (after.until || 0) > Date.now()) return; // App ist offen
  const w = await worker(Date.now());
  await w.processUser(event.params.uid);
});

export const lernkiSweep = onSchedule({ schedule: 'every 10 minutes', timeoutSeconds: 540 }, async () => {
  const w = await worker(Date.now());
  await w.sweep();
});
