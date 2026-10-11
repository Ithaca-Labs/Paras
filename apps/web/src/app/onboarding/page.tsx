import { cookies } from 'next/headers';
import { PageHeader } from '@/components/app-shell';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Onboarding' };

export default async function OnboardingPage() {
  const api = serverApi((await cookies()).toString());
  const [cats, options, initial] = await Promise.all([
    api.listCategories(),
    api.getOnboardingOptions(),
    api.getProfile(),
  ]);
  return (
    <>
      <PageHeader title="Tune your Feed">Tell us what you care about. Works signed out.</PageHeader>
      <OnboardingWizard tree={cats.items} options={options} initial={initial} />
    </>
  );
}
