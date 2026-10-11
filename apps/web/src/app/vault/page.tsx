import { PageHeader } from '@/components/app-shell';
import { AnyChainDeposit } from '@/components/any-chain-deposit';
import { EmptyState } from '@/components/states';

export const metadata = { title: 'Vault' };

// STUB page (#29 builds the Vault UI).
export default function VaultPage() {
  return (
    <>
      <PageHeader title="Vault" />
      <EmptyState>Vault UI lands in #29.</EmptyState>
      <AnyChainDeposit />
    </>
  );
}
