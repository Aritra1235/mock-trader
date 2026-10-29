import { log } from "../../lib/log";

/** One pass at a time; persisted orders are picked up again after a restart. */
export function startOrderProcessor(
  service: {
    processOpenOrders(): Promise<void>;
    squareOffIntradayPositions(): Promise<void>;
  },
  intervalMs = 2_000,
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await service.processOpenOrders();
      await service.squareOffIntradayPositions();
    } catch (error) {
      log.error("order processor pass failed", { error });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  return () => clearInterval(timer);
}
