import { PageHeader } from '@/components/app-shell';
import { DelegationSettings } from '@/components/delegation-settings';

export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <DelegationSettings />
    </>
  );
}
