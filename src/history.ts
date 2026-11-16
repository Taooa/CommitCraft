import { candidates, Recent } from './model';
import { validId } from './fields';

export type History = Record<keyof Recent, string[]>;
interface StoredSelections { recent: Recent; history: History }
interface Storage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function createHistoryStore(storage: Storage) {
  function recent(key: string): Recent | undefined {
    const raw = storage.get<StoredSelections>(`selections:${key}`)?.recent
      ?? storage.get<Recent>(`recent:${key}`);
    if (!raw || typeof raw !== 'object') return undefined;
    return Object.fromEntries(Object.entries(raw).filter(([id, value]) => validId(id) && typeof value === 'string' && !/[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(value)));
  }
  function history(key: string): History {
    const stored = storage.get<StoredSelections>(`selections:${key}`)?.history;
    const last = recent(key);
    function fieldValues(field: string): string[] {
      return candidates(last?.[field] ? [last[field]] : [], Array.isArray(stored?.[field]) ? stored[field] : [])
        .filter(value => !/[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(value));
    }
    return Object.fromEntries([...new Set(['type', 'version', 'module', ...Object.keys(stored ?? {}), ...Object.keys(last ?? {})])]
      .filter(validId).map(field => [field, fieldValues(field)]));
  }
  return {
    recent, history,
    async save(key: string, values: Recent): Promise<void> {
      const previous = history(key);
      const normalized: Recent = { ...recent(key) };
      const next: History = { ...previous };
      for (const [field, value] of Object.entries(values)) {
        if (!validId(field) || typeof value !== 'string' || /[\r\n\u2028\u2029\x00-\x1f\x7f]/u.test(value)) throw new Error('Invalid history value.');
        normalized[field] = values[field].trim();
        next[field] = candidates([normalized[field]], previous[field] ?? []);
      }
      // Keep defaults and accumulated candidates consistent in one persistent update.
      await storage.update(`selections:${key}`, { recent: normalized, history: next } satisfies StoredSelections);
    }
  };
}
