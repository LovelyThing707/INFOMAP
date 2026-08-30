import { router, type Href } from 'expo-router';

/**
 * モーダルを閉じる。
 *
 * URL を直接開いたときや再読み込みした直後は戻り先の履歴がなく、
 * router.back() が「GO_BACK was not handled by any navigator」になる。
 * その場合は行き先を指定して置き換える。
 */
export function closeModal(fallback: Href = '/'): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}

/** 積まれているモーダルを全部閉じてからタブへ移る */
export function dismissToTab(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.navigate(href);
}
