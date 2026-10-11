import { ApiError } from '@paras/shared';
import { PageHeader } from '@/components/app-shell';
import { ConsentForm } from '@/components/consent-form';
import { ErrorState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Connect app' };
export const dynamic = 'force-dynamic';

// API `/oauth/authorize` redirects here (set OAUTH_CONSENT_URL=<web>/oauth/consent) with the OAuth params.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams;
  if (!p.client_id || !p.redirect_uri || !p.response_type)
    return <ErrorState message="Invalid connection request." />;
  let name: string;
  try {
    ({ name } = await serverApi().getOAuthClient({ params: { id: p.client_id } }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404)
      return <ErrorState message="Unknown app. Start again from the app." />;
    throw e;
  }
  const scopes = (p.scope ?? 'markets:read').split(' ').filter(Boolean);
  return (
    <>
      <PageHeader title={`Connect ${name}`}>Review what this app can access.</PageHeader>
      <ConsentForm clientName={name} scopes={scopes} params={p} />
    </>
  );
}
