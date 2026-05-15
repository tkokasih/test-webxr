import type { NoteRecord } from './types';

const KEY = 'vrnotes/v1';

export function loadAll(): NoteRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is NoteRecord =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as NoteRecord).uuid === 'string' &&
        typeof (r as NoteRecord).text === 'string'
    );
  } catch {
    return [];
  }
}

export function saveAll(records: NoteRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records));
}

export function upsert(record: NoteRecord): void {
  const all = loadAll();
  const i = all.findIndex((r) => r.uuid === record.uuid);
  if (i >= 0) all[i] = record;
  else all.push(record);
  saveAll(all);
}

export function remove(uuid: string): void {
  saveAll(loadAll().filter((r) => r.uuid !== uuid));
}
