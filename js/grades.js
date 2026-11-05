// Noten-Umrechnung. Achtung: Schulen nutzen unterschiedliche Schlüssel – das hier ist eine Schätzung
// nach dem verbreiteten Oberstufen-Schlüssel (15 Punkte ≥ 95 % … 1 Punkt ≥ 20 %).

import { state } from './store.js';

const POINT_THRESHOLDS = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 33, 27, 20]; // 15 … 1

export const scale = () => state.profile?.gradeScale || '1-6';
export const scaleLabel = () => (scale() === '0-15' ? 'Punkte 15 (beste) bis 0' : 'Noten 1 (beste) bis 6');

export function percentToPoints(pct) {
  for (let i = 0; i < POINT_THRESHOLDS.length; i++) if (pct >= POINT_THRESHOLDS[i]) return 15 - i;
  return 0;
}

export function pointsToNote(p) {
  if (p >= 13) return 1;
  if (p >= 10) return 2;
  if (p >= 7) return 3;
  if (p >= 4) return 4;
  if (p >= 1) return 5;
  return 6;
}

export function percentToGrade(pct) {
  const p = percentToPoints(pct);
  return scale() === '0-15' ? p : pointsToNote(p);
}

export function gradeLabel(g) {
  if (g === null || g === undefined) return '–';
  return scale() === '0-15' ? `${g} Punkte` : `Note ${g}`;
}

export function gradeOptions() {
  return scale() === '0-15'
    ? Array.from({ length: 16 }, (_, i) => 15 - i)
    : [1, 2, 3, 4, 5, 6];
}

export function reachesTarget(grade, target) {
  return scale() === '0-15' ? grade >= target : grade <= target;
}
