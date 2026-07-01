import { LivePriceWebSocket } from "./src/livePriceWebSocket";

describe("LivePriceWebSocket", () => {
  let livePriceWebSocket: LivePriceWebSocket;

  beforeEach(() => {
    livePriceWebSocket = new LivePriceWebSocket();
    livePriceWebSocket.setOnOpenListener(() => undefined);
    livePriceWebSocket.setOnCloseListener(() => undefined);
    livePriceWebSocket.setOnMessageListener(() => undefined);
    livePriceWebSocket.setOnErrorListener(() => undefined);
  });

  test("set listeners safely", () => {
    livePriceWebSocket.setOnOpenListener(null);
    livePriceWebSocket.setOnCloseListener(null);
    livePriceWebSocket.setOnMessageListener(null);
    livePriceWebSocket.setOnErrorListener(null);
  });

  test("parseBinary handles LTP packet", () => {
    const byteBuffer = Buffer.alloc(23);
    const dataView = new DataView(byteBuffer.buffer);
    dataView.setInt8(0, 61);
    dataView.setFloat32(1, 100);
    dataView.setInt32(5, 100);
    dataView.setInt32(9, 100);
    dataView.setInt8(13, 1);
    dataView.setInt8(14, 1);
    dataView.setFloat32(15, 100);
    dataView.setFloat32(19, 100);
    livePriceWebSocket.parseBinary(byteBuffer);
  });

  test("parseBinary handles quote packet", () => {
    const byteBuffer = Buffer.alloc(67);
    const dataView = new DataView(byteBuffer.buffer);
    dataView.setInt8(0, 62);
    dataView.setFloat32(1, 100);
    dataView.setInt32(5, 100);
    dataView.setInt32(9, 100);
    dataView.setInt8(13, 1);
    dataView.setInt8(14, 1);
    dataView.setInt32(15, 100);
    dataView.setFloat32(19, 100);
    dataView.setInt32(23, 100);
    dataView.setInt32(27, 100);
    dataView.setInt32(31, 100);
    dataView.setFloat32(35, 100);
    dataView.setFloat32(39, 100);
    dataView.setFloat32(43, 100);
    dataView.setFloat32(47, 100);
    dataView.setFloat32(51, 100);
    dataView.setFloat32(55, 100);
    dataView.setFloat32(59, 100);
    dataView.setFloat32(63, 100);
    livePriceWebSocket.parseBinary(byteBuffer);
  });

  test("parseBinary handles full packet", () => {
    const byteBuffer = Buffer.alloc(175);
    const dataView = new DataView(byteBuffer.buffer);
    const depth_size = 20;

    for (let i = 0; i < 5; i++) {
      dataView.setInt32(1 + i * depth_size, 100);
      dataView.setInt32(5 + i * depth_size, 100);
      dataView.setInt16(9 + i * depth_size, 100);
      dataView.setInt16(11 + i * depth_size, 100);
      dataView.setFloat32(13 + i * depth_size, 100);
      dataView.setFloat32(17 + i * depth_size, 100);
    }

    dataView.setInt8(0, 63);
    dataView.setFloat32(101, 100);
    dataView.setInt32(105, 100);
    dataView.setInt32(109, 100);
    dataView.setInt8(113, 1);
    dataView.setInt8(114, 1);
    dataView.setInt32(115, 100);
    dataView.setFloat32(119, 100);
    dataView.setInt32(123, 100);
    dataView.setInt32(127, 100);
    dataView.setInt32(131, 100);
    dataView.setFloat32(135, 100);
    dataView.setFloat32(139, 100);
    dataView.setFloat32(143, 100);
    dataView.setFloat32(147, 100);
    dataView.setFloat32(151, 100);
    dataView.setFloat32(155, 100);
    dataView.setFloat32(159, 100);
    dataView.setFloat32(163, 100);
    dataView.setInt32(167, 100);
    dataView.setInt32(171, 100);
    livePriceWebSocket.parseBinary(byteBuffer);
  });
});
