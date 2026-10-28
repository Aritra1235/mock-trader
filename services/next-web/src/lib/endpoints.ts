const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

// localhost and 127.0.0.1 are different sites to the browser, so a page on one
// calling the API on the other loses the SameSite session cookie. When both
// are loopback, call the API on the page's own loopback name.
function onPageHost(raw: string) {
  const url = new URL(raw);
  if (
    typeof window !== "undefined" &&
    loopback.has(url.hostname) &&
    loopback.has(window.location.hostname)
  )
    url.hostname = window.location.hostname;
  return url.toString().replace(/\/+$/, "");
}

export const apiBase = onPageHost(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000",
);

export function marketSocketUrl() {
  return onPageHost(
    process.env.NEXT_PUBLIC_MARKET_WS_URL ??
      `${apiBase.replace(/^http/, "ws")}/ws/market`,
  );
}
