import { OrdersScreen, type OrdersTab } from "@/components/screens/orders";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const selected: OrdersTab =
    tab === "trades" || tab === "funds" ? tab : "orders";
  return <OrdersScreen tab={selected} />;
}
