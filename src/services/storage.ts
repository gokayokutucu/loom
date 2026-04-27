export interface StorageAdapter {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

export const localStorageAdapter: StorageAdapter = {
  get(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? (JSON.parse(value) as typeof fallback) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is an enhancement in the web prototype.
    }
  },
};
