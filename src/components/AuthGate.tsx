import type { ReactNode } from 'react';

import { ThemePreferencePicker } from '@/components/ThemePreferencePicker';
import { openSignIn } from '@/lib/auth-gate';
import { useSession } from '@/state/session';

import { Screen } from './Screen';
import { Button, EmptyState } from './ui';

export function AuthGate({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  const signedIn = useSession((s) => s.signedIn);
  if (signedIn) return children ?? null;
  return (
    <Screen title={title}>
      <EmptyState title="ログインすると使えます" body={body} />
      <Button label="ログイン / 新規登録" onPress={openSignIn} />
      <ThemePreferencePicker />
    </Screen>
  );
}
