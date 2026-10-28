/** Next may hand a dynamic route an encoded segment; the API client encodes it again. */
export function instrumentIdFromRoute(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
