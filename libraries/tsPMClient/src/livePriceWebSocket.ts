import WebSocket from "ws";
import { endpoints } from "./constants";
import { EpochConverter } from "./epochConverterUtil";

type MessageListener = (arr: Array<Record<string, unknown>>) => void;
type OpenListener = () => void;
type CloseListener = (code: number, reason: Buffer) => void;
type ErrorListener = (err: unknown) => void;

/**
 * This class handles websocket connection required for streaming live price of stocks.
 */
export class LivePriceWebSocket {
  private socket?: WebSocket;
  private url?: string;
  private jwtToken?: string;

  private onOpenListener: OpenListener = () => undefined;
  private onCloseListener: CloseListener = () => undefined;
  private onMessageListener: MessageListener = () => undefined;
  private onErrorListener: ErrorListener = () => undefined;

  private doReconnect = false;
  private maxReconnectAttempt = 5;
  private reconnectCount = 0;
  private reconnectDelay = 2000;
  private errorCode: number | null = null;

  setOnOpenListener(onOpenListener: OpenListener | null) {
    this.onOpenListener = onOpenListener ?? (() => undefined);
  }

  setOnCloseListener(onCloseListener: CloseListener | null) {
    this.onCloseListener = onCloseListener ?? (() => undefined);
  }

  setOnMessageListener(onMessageListener: MessageListener | null) {
    this.onMessageListener = onMessageListener ?? (() => undefined);
  }

  setOnErrorListener(onErrorListener: ErrorListener | null) {
    this.onErrorListener = onErrorListener ?? (() => undefined);
  }

  setReconnectConfig(doReconnect: boolean, maxReconnectAttempt: number) {
    this.doReconnect = doReconnect;
    this.maxReconnectAttempt = maxReconnectAttempt;
  }

  /**
   * This method creates a websocket connection with broadcast server
   * @param jwt Public Access Token
   */
  connect(jwt: string) {
    this.jwtToken = jwt;
    this.url = `${endpoints.websocket_url}${jwt}`;
    this.socket = new WebSocket(this.url);

    this.socket.on("open", () => {
      console.log("connection made with server");
      this.resetReconnectCount();
      this.onOpenListener();
    });

    this.socket.on("close", (code, reason) => {
      this.onCloseListener(code, reason);
      if (this.doReconnect && code !== 1000 && this.errorCode === null) {
        this.reconnect();
      }
      this.errorCode = null;
    });

    this.socket.on("message", (packet) => {
      if (typeof packet === "string") {
        this.onErrorListener(packet);
        return;
      }

      const buffer = this.normalizePacket(packet);
      this.onMessageListener(this.parseBinary(buffer));
    });

    this.socket.on("error", (err: Error) => {
      this.onErrorListener(err);
      const match = err.message.match(/(\d+)/);
      this.errorCode = match ? parseInt(match[1], 10) : null;
      if (
        this.doReconnect &&
        ((this.errorCode && this.errorCode >= 500 && this.errorCode < 600) ||
          err.message.includes("ECONNREFUSED"))
      ) {
        this.reconnect();
      }
    });
  }

  /**
   * This method subscribes the preferences sent by user with Broadcast Server
   * @param pref array of preferences
   */
  subscribe(pref: Array<Record<string, unknown>>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log("Socket is not in ready state!");
      return;
    }
    this.socket.send(JSON.stringify(pref));
    console.log("preferences sent");
  }

  /**
   * This method acts a sleep method for current flow execution. In the meantime, any other flow can get executed
   * @param timeout number of milliseconds
   */
  delay(timeout: number) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }

  /**
   * This method tries to reconnect to server for maxReconnectAttempt times.
   */
  async reconnect() {
    await this.delay(this.reconnectDelay);
    this.reconnectDelay *= 2;
    this.reconnectCount += 1;
    if (this.reconnectCount <= this.maxReconnectAttempt && this.jwtToken) {
      this.connect(this.jwtToken);
    }
    if (this.reconnectCount > this.maxReconnectAttempt) {
      this.resetReconnectCount();
    }
  }

  resetReconnectCount() {
    this.reconnectCount = 0;
    this.reconnectDelay = 2000;
  }

  /**
   * This method is used to close websocket connection with the server.
   */
  disconnect() {
    if (
      this.socket &&
      this.socket.readyState !== WebSocket.CLOSING &&
      this.socket.readyState !== WebSocket.CLOSED
    ) {
      this.socket.close();
    }
  }

  /**
   * This method parses the packets received from Broadcast Server (in ByteBuffer) to human-readable format
   * @param packet ByteBuffer response packet received from Broadcast server
   * @returns response parsed in human-readable format
   */
  parseBinary(packet: Uint8Array) {
    const len = packet.length;
    const response: Array<Record<string, unknown>> = [];
    const ab = new ArrayBuffer(len);
    const dv = new Int8Array(ab);
    for (let i = 0; i < len; ++i) {
      dv[i] = packet[i];
    }
    const dvu = new DataView(ab);
    let position = 0;
    while (position !== len) {
      const type = dvu.getInt8(position);
      position = position + 1;
      switch (type) {
        case 64:
          processIndexLtpPacket();
          break;
        case 65:
          processIndexQuotePacket();
          break;
        case 66:
          processIndexFullPacket();
          break;
        case 61:
          processLtpPacket();
          break;
        case 62:
          processQuotePacket();
          break;
        case 63:
          processFullPacket();
          break;
      }
    }

    function processLtpPacket() {
      response.push({
        last_price: dvu.getFloat32(position, true).toFixed(2),
        last_trade_time: EpochConverter(dvu.getInt32(position + 4, true)),
        security_id: dvu.getInt32(position + 8, true),
        tradable: dvu.getInt8(position + 12, true),
        mode: dvu.getInt8(position + 13, true),
        change_absolute: dvu.getFloat32(position + 14, true).toFixed(2),
        change_percent: dvu.getFloat32(position + 18, true).toFixed(2)
      });
      position = position + 22;
    }

    function processIndexLtpPacket() {
      response.push({
        last_price: dvu.getFloat32(position, true).toFixed(2),
        last_update_time: EpochConverter(dvu.getInt32(position + 4, true)),
        security_id: dvu.getInt32(position + 8, true),
        tradable: dvu.getInt8(position + 12, true),
        mode: dvu.getInt8(position + 13, true),
        change_absolute: dvu.getFloat32(position + 14, true).toFixed(2),
        change_percent: dvu.getFloat32(position + 18, true).toFixed(2)
      });
      position = position + 22;
    }

    function processQuotePacket() {
      response.push({
        last_price: dvu.getFloat32(position, true).toFixed(2),
        last_trade_time: EpochConverter(dvu.getInt32(position + 4, true)),
        security_id: dvu.getInt32(position + 8, true),
        tradable: dvu.getInt8(position + 12, true),
        mode: dvu.getInt8(position + 13, true),
        last_traded_quantity: dvu.getInt32(position + 14, true),
        average_traded_price: dvu.getFloat32(position + 18, true).toFixed(2),
        volume_traded: dvu.getUint32(position + 22, true),
        total_buy_quantity: dvu.getInt32(position + 26, true),
        total_sell_quantity: dvu.getInt32(position + 30, true),
        open: dvu.getFloat32(position + 34, true).toFixed(2),
        close: dvu.getFloat32(position + 38, true).toFixed(2),
        high: dvu.getFloat32(position + 42, true).toFixed(2),
        low: dvu.getFloat32(position + 46, true).toFixed(2),
        change_percent: dvu.getFloat32(position + 50, true).toFixed(2),
        change_absolute: dvu.getFloat32(position + 54, true).toFixed(2),
        fifty_two_week_high: dvu.getFloat32(position + 58, true).toFixed(2),
        fifty_two_week_low: dvu.getFloat32(position + 62, true).toFixed(2)
      });
      position = position + 66;
    }

    function processIndexQuotePacket() {
      response.push({
        last_price: dvu.getFloat32(position, true).toFixed(2),
        security_id: dvu.getInt32(position + 4, true),
        tradable: dvu.getInt8(position + 8, true),
        mode: dvu.getInt8(position + 9, true),
        open: dvu.getFloat32(position + 10, true).toFixed(2),
        close: dvu.getFloat32(position + 14, true).toFixed(2),
        high: dvu.getFloat32(position + 18, true).toFixed(2),
        low: dvu.getFloat32(position + 22, true).toFixed(2),
        change_percent: dvu.getFloat32(position + 26, true).toFixed(2),
        change_absolute: dvu.getFloat32(position + 30, true).toFixed(2),
        fifty_two_week_high: dvu.getFloat32(position + 34, true).toFixed(2),
        fifty_two_week_low: dvu.getFloat32(position + 38, true).toFixed(2)
      });
      position = position + 42;
    }

    function processFullPacket() {
      const depth_size = 20;
      const depthPacket: Record<string, Record<string, unknown>> = {};
      for (let i = 0; i < 5; i++) {
        const depth = `depth_packet_#${i + 1}`;
        const depthObj: Record<string, unknown> = {};
        depthObj.buy_quantity = dvu.getInt32(position + i * depth_size, true);
        depthObj.sell_quantity = dvu.getInt32(position + 4 + i * depth_size, true);
        depthObj.buy_order = dvu.getInt16(position + 8 + i * depth_size, true);
        depthObj.sell_order = dvu.getInt16(position + 10 + i * depth_size, true);
        depthObj.buy_price = dvu.getFloat32(position + 12 + i * depth_size, true).toFixed(2);
        depthObj.sell_price = dvu.getFloat32(position + 16 + i * depth_size, true).toFixed(2);
        depthPacket[depth] = depthObj;
      }

      const tick: Record<string, unknown> = {};
      tick.depthPacket = depthPacket;
      position += 100;

      tick.last_price = dvu.getFloat32(position, true).toFixed(2);
      tick.last_trade_time = EpochConverter(dvu.getInt32(position + 4, true));
      tick.security_id = dvu.getInt32(position + 8, true);
      tick.tradable = dvu.getInt8(position + 12, true);
      tick.mode = dvu.getInt8(position + 13, true);
      tick.last_traded_quantity = dvu.getInt32(position + 14, true);
      tick.average_traded_price = dvu.getFloat32(position + 18, true).toFixed(2);
      tick.volume_traded = dvu.getUint32(position + 22, true);
      tick.total_buy_quantity = dvu.getInt32(position + 26, true);
      tick.total_sell_quantity = dvu.getInt32(position + 30, true);
      tick.open = dvu.getFloat32(position + 34, true).toFixed(2);
      tick.close = dvu.getFloat32(position + 38, true).toFixed(2);
      tick.high = dvu.getFloat32(position + 42, true).toFixed(2);
      tick.low = dvu.getFloat32(position + 46, true).toFixed(2);
      tick.change_percent = dvu.getFloat32(position + 50, true).toFixed(2);
      tick.change_absolute = dvu.getFloat32(position + 54, true).toFixed(2);
      tick.fifty_two_week_high = dvu.getFloat32(position + 58, true).toFixed(2);
      tick.fifty_two_week_low = dvu.getFloat32(position + 62, true).toFixed(2);
      tick.OI = dvu.getUint32(position + 66, true);
      tick.OI_change = dvu.getInt32(position + 70, true);

      response.push(tick);
      position += 74;
    }

    function processIndexFullPacket() {
      response.push({
        last_price: dvu.getFloat32(position, true).toFixed(2),
        security_id: dvu.getInt32(position + 4, true),
        tradable: dvu.getInt8(position + 8, true),
        mode: dvu.getInt8(position + 9, true),
        open: dvu.getFloat32(position + 10, true).toFixed(2),
        close: dvu.getFloat32(position + 14, true).toFixed(2),
        high: dvu.getFloat32(position + 18, true).toFixed(2),
        low: dvu.getFloat32(position + 22, true).toFixed(2),
        change_percent: dvu.getFloat32(position + 26, true).toFixed(2),
        change_absolute: dvu.getFloat32(position + 30, true).toFixed(2),
        last_update_time: EpochConverter(dvu.getInt32(position + 34, true))
      });
      position = position + 38;
    }

    return response;
  }

  private normalizePacket(packet: WebSocket.RawData) {
    if (Buffer.isBuffer(packet)) {
      return packet;
    }
    if (packet instanceof ArrayBuffer) {
      return new Uint8Array(packet);
    }
    if (Array.isArray(packet)) {
      return Buffer.concat(packet);
    }
    return Buffer.from(packet);
  }
}
