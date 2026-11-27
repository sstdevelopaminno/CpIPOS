/** Only expected sales-entry denials are rendered as an access notice.
 * Next redirects, genuine missing routes and transient failures retain their normal handling.
 */
export type PosSalesDenialReason = "menu" | "feature" | "permission" | "shift" | "subscription" | "mode";

export class PosSalesPageDenied extends Error {
  constructor(public readonly reason: PosSalesDenialReason) {
    super("pos_sales_entry_denied:" + reason);
    this.name = "PosSalesPageDenied";
  }
}
