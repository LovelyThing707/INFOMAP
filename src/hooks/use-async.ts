import { useEffect, useState, type DependencyList } from 'react';

export interface AsyncValue<T> {
  value: T;
  loading: boolean;
}

/**
 * deps が変わったら取り直すだけの薄いフック。
 * 取り直し中に loading を立て直さないのは、値が入れ替わるまで前の内容を出しておいた方が
 * 1秒ごとに動く画面ではちらつかないため。
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  initial: T
): AsyncValue<T> {
  const [state, setState] = useState<AsyncValue<T>>({ value: initial, loading: true });

  useEffect(() => {
    let alive = true;
    loader()
      .then((next) => {
        if (alive) setState({ value: next, loading: false });
      })
      .catch(() => {
        if (alive) setState((current) => ({ ...current, loading: false }));
      });
    return () => {
      alive = false;
    };
    // loader は毎レンダー作り直されるので依存に入れない。呼び出し側が deps を管理する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
