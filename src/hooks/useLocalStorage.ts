import { useEffect, useState } from 'react';

type Options<T> = {
  serialize?: (v: T) => string;
  deserialize?: (s: string) => T;
};

export function useLocalStorage<T>(key: string, initial: T, options?: Options<T>) {
  const serialize = options?.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize = options?.deserialize ?? ((s: string) => JSON.parse(s) as T);

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return deserialize(raw);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, serialize(value)); } catch {}
  }, [key, value, serialize]);

  return [value, setValue] as const;
}

