import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildInstrumentKey,
  normalizeMode,
  parseSecurityMaster,
} from "../lib/market";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import type { InstrumentRecord, MarketMode, SubscriptionPreference } from "../types/market";

interface SearchOptions {
  q?: string;
  limit?: number;
  exchange?: string;
  scripType?: string;
}

export class CatalogService {
  private instruments = new Map<string, InstrumentRecord>();
  private bySecurityId = new Map<string, InstrumentRecord[]>();
  private bySymbol = new Map<string, InstrumentRecord[]>();
  private lastSyncedAt: string | null = null;

  constructor(
    private readonly client: PaytmHttpClient,
    private readonly snapshotPath: string,
    private readonly fileNames: string[]
  ) {}

  async loadSnapshot() {
    try {
      const raw = await readFile(this.snapshotPath, "utf-8");
      const records = JSON.parse(raw) as InstrumentRecord[];
      this.replaceRecords(records);
      const fileStat = await stat(this.snapshotPath);
      this.lastSyncedAt = fileStat.mtime.toISOString();
      return true;
    } catch {
      return false;
    }
  }

  async syncFromProvider() {
    const merged = new Map<string, InstrumentRecord>();

    for (const fileName of this.fileNames) {
      const csv = await this.client.fetchSecurityMaster(fileName);
      for (const record of parseSecurityMaster(csv)) {
        merged.set(record.instrumentKey, record);
      }
    }

    const records = Array.from(merged.values()).sort((left, right) =>
      left.symbol.localeCompare(right.symbol)
    );

    await mkdir(dirname(this.snapshotPath), { recursive: true });
    await writeFile(this.snapshotPath, JSON.stringify(records, null, 2), "utf-8");
    this.replaceRecords(records);
    this.lastSyncedAt = new Date().toISOString();
    return records.length;
  }

  count() {
    return this.instruments.size;
  }

  getLastSyncedAt() {
    return this.lastSyncedAt;
  }

  getByInstrumentKey(key: string) {
    return this.instruments.get(key) ?? null;
  }

  resolve(input: string) {
    const value = input.trim();
    if (!value) {
      return null;
    }

    const byKey = this.instruments.get(value);
    if (byKey) {
      return byKey;
    }

    const bySecurityId = this.bySecurityId.get(value);
    if (bySecurityId?.length) {
      return bySecurityId[0];
    }

    const upper = value.toUpperCase();
    const bySymbol = this.bySymbol.get(upper);
    if (bySymbol?.length) {
      return bySymbol[0];
    }

    return this.search({ q: value, limit: 1 })[0] ?? null;
  }

  search(options: SearchOptions) {
    const q = options.q?.trim().toLowerCase() ?? "";
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const exchange = options.exchange?.toUpperCase();
    const scripType = options.scripType?.toUpperCase();

    const records = Array.from(this.instruments.values()).filter((record) => {
      if (exchange && record.exchange !== exchange) {
        return false;
      }
      if (scripType && record.scripType !== scripType) {
        return false;
      }
      return true;
    });

    if (!q) {
      return records.slice(0, limit);
    }

    return records
      .map((record) => ({
        record,
        score: scoreRecord(record, q),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => entry.record);
  }

  resolvePreference(
    input: Record<string, unknown>,
    defaultMode: MarketMode
  ): SubscriptionPreference | null {
    const modeType = normalizeMode(input.modeType, defaultMode);

    if (typeof input.instrumentKey === "string") {
      const instrument = this.getByInstrumentKey(input.instrumentKey);
      if (!instrument) {
        return null;
      }
      return {
        instrumentKey: instrument.instrumentKey,
        securityId: instrument.securityId,
        exchangeType: instrument.exchange,
        scripType: instrument.scripType,
        modeType,
      };
    }

    if (typeof input.securityId === "string" || typeof input.scripId === "string") {
      const instrument = this.resolve(String(input.securityId ?? input.scripId));
      if (instrument) {
        return {
          instrumentKey: instrument.instrumentKey,
          securityId: instrument.securityId,
          exchangeType: instrument.exchange,
          scripType: instrument.scripType,
          modeType,
        };
      }
    }

    if (typeof input.symbol === "string") {
      const instrument = this.resolve(input.symbol);
      if (instrument) {
        return {
          instrumentKey: instrument.instrumentKey,
          securityId: instrument.securityId,
          exchangeType: instrument.exchange,
          scripType: instrument.scripType,
          modeType,
        };
      }
    }

    if (
      typeof input.exchangeType === "string" &&
      typeof input.scripType === "string" &&
      (typeof input.scripId === "string" || typeof input.scripId === "number")
    ) {
      const securityId = String(input.scripId);
      return {
        instrumentKey: buildInstrumentKey(
          input.exchangeType.toUpperCase(),
          input.scripType.toUpperCase(),
          securityId
        ),
        securityId,
        exchangeType: input.exchangeType.toUpperCase(),
        scripType: input.scripType.toUpperCase(),
        modeType,
      };
    }

    return null;
  }

  private replaceRecords(records: InstrumentRecord[]) {
    this.instruments = new Map(records.map((record) => [record.instrumentKey, record]));
    this.bySecurityId = new Map();
    this.bySymbol = new Map();

    for (const record of records) {
      const securityList = this.bySecurityId.get(record.securityId) ?? [];
      securityList.push(record);
      this.bySecurityId.set(record.securityId, securityList);

      const symbolList = this.bySymbol.get(record.symbol) ?? [];
      symbolList.push(record);
      this.bySymbol.set(record.symbol, symbolList);
    }
  }
}

function scoreRecord(record: InstrumentRecord, q: string) {
  if (record.symbol.toLowerCase() === q) {
    return 100;
  }
  if (record.securityId === q) {
    return 95;
  }
  if (record.symbol.toLowerCase().startsWith(q)) {
    return 80;
  }
  if (record.name.toLowerCase().startsWith(q)) {
    return 70;
  }
  if (record.searchableText.includes(q)) {
    return 50;
  }
  return 0;
}
