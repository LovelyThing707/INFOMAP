import { LogBox, Platform } from 'react-native';

const VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

function lockViewport(): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', VIEWPORT);
}

/**
 * react-native-web の Responder は、Leaflet や gesture-handler が
 * touchend を途中で止めると「Cannot find single active touch.」を console.error する。
 * 実害はなく、Expo の LogBox が赤画面にして操作を止めるのが問題。
 */
export function installWebTouchGuard(): void {
  if (Platform.OS !== 'web') return;

  lockViewport();
  LogBox.ignoreLogs(['Cannot find single active touch']);

  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Cannot find single active touch')) {
      return;
    }
    original(...args);
  };
}
