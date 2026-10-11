import { ApiError } from '@paras/shared';
import { cookies } from 'next/headers';
import { PageHeader } from '@/components/app-shell';
import { ConnectedAppsList } from '@/components/connected-apps-list';
import { SignInGate } from '@/components/sign-in-gate';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Connected apps' };

export default async function ConnectedAppsPage() {
  const cookie = (await cookies()).toString();
  let items;
  try {
    ({ items } = await serverApi(cookie).listConnectedApps());
  } catch (e) {
    if (e instanceof ApiError && e.status === 401)
      return (
        <>
          <PageHeader title="Connected apps" />
          <SignInGate message="Sign in to manage connected apps." />
        </>
      );
    throw e;
  }
  return (
    <>
      <PageHeader title="Connected apps">
        Claude, Codex and other apps you let read Paras. They are read-only and cannot trade.
      </PageHeader>
      <ConnectedAppsList initial={items} />
    </>
  );
}
