const requestIds = new WeakMap<Request, string>();

export function requestIdFor(request: Request) {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestIds.set(request, requestId);
  return requestId;
}
