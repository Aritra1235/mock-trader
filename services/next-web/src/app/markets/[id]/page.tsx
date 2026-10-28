import { InstrumentScreen } from "@/components/screens/instrument";
import { instrumentIdFromRoute } from "@/lib/instrument-route";

export default async function InstrumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InstrumentScreen instrumentId={instrumentIdFromRoute(id)} />;
}
