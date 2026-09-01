import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'infomap.welcome.seen.v1';

/** 初回歓迎画面をすでに閉じたか（スキップ／登録導線へ進んだ） */
export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // 端末保存に失敗しても先へ進める。次回また出る程度。
  }
}

/** 確認用。フラグを消して初回画面を再現する */
export async function resetWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
