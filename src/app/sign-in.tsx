import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { SignIn } from '@/components/SignIn';
import { closeModal } from '@/lib/navigation';
import { useSession } from '@/state/session';

export default function SignInModal() {
  const signedIn = useSession((s) => s.signedIn);
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const raw = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const initialMode = raw === 'signIn' ? 'signIn' : 'signUp';

  useEffect(() => {
    if (signedIn) closeModal('/');
  }, [signedIn]);

  return <SignIn initialMode={initialMode} />;
}
