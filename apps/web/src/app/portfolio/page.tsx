import { PageHeader } from '@/components/app-shell';
import { PortfolioView } from '@/components/portfolio-view';

export const metadata = { title: 'Portfolio' };

export default function PortfolioPage() {
  return (
    <>
      <PageHeader title="Portfolio">Positions, P&amp;L and Vault history.</PageHeader>
      <PortfolioView />
    </>
  );
}
