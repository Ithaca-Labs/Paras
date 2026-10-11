import { PageHeader } from '@/components/app-shell';
import { OrdersList } from '@/components/orders-list';

export const metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="Orders">Limit, take-profit and stop-loss orders.</PageHeader>
      <OrdersList />
    </>
  );
}
