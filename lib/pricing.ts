/** How long a canvassed price is trusted before it should be re-confirmed
 *  with the supplier -- canvassed pricelists routinely change, and once a
 *  price is copied into a Purchase Request (and later a Purchase Order)
 *  it's frozen there (a supplier's price change afterward doesn't
 *  retroactively edit an already-generated PR/PO), so the integrity risk
 *  is entirely upstream of that: using an old, possibly-no-longer-valid
 *  quote when the PR/PO is first generated. 60 days matches the typical
 *  quotation-validity window suppliers give in Philippine procurement. */
export const PRICE_VALIDITY_DAYS = 60;

export function daysSincePriced(canvassDateOrCreatedAt: string): number {
  if (!canvassDateOrCreatedAt) return 0;
  const then = new Date(canvassDateOrCreatedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86400000);
}

export function isPriceStale(canvassDateOrCreatedAt: string): boolean {
  return daysSincePriced(canvassDateOrCreatedAt) > PRICE_VALIDITY_DAYS;
}
