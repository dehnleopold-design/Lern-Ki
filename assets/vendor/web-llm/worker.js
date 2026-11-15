// Läuft als Web Worker: rechnet die Offline-KI, damit die App flüssig bleibt.
import { WebWorkerMLCEngineHandler } from './web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
