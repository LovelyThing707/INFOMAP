import { useEffect, useState } from 'react';

/**
 * 残り時間と鮮度は常に動いていないと嘘になるので、画面側で時計を回す。
 * 秒表示が要る場所は 1000ms、リストは 5000ms で十分。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
