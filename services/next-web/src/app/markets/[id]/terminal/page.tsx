import { TerminalScreen } from "@/components/screens/terminal";
import { instrumentIdFromRoute } from "@/lib/instrument-route";

export default async function TerminalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TerminalScreen instrumentId={instrumentIdFromRoute(id)} />;
}
