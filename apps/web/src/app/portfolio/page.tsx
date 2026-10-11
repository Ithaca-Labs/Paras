import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/states';

export const metadata = { title: 'Portfolio' };

// STUB page (#30 builds the Portfolio UI).
export default function PortfolioPage() {
  return (
    <>
      <PageHeader title="Portfolio" />
      <EmptyState>Portfolio UI lands in #30.</EmptyState>
    </>
  );
}
