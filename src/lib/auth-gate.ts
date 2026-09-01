import { router } from 'expo-router';

import { useSession } from '@/state/session';

/** 見るだけはログイン不要。買う・売る・頼むときに開く */
export function openSignIn(): void {
  router.push('/sign-in');
}

export function requireSignedIn(): boolean {
  if (useSession.getState().signedIn) return true;
  openSignIn();
  return false;
}
