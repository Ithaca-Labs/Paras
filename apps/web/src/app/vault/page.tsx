import { PageHeader } from '@/components/app-shell';
import { AnyChainDeposit } from '@/components/any-chain-deposit';
import { VaultApp } from '@/components/vault-app';

export const metadata = { title: 'Vault' };

export default function VaultPage() {
  return (
    <>
      <PageHeader title="Vault">Your segregated USDC balance on Monad.</PageHeader>
      <VaultApp />
      <AnyChainDeposit />
    </>
  );
}
