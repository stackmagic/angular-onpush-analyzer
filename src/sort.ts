/** Code unit order, independent of the locale, so output ordering is stable everywhere. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
