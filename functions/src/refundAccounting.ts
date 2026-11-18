export interface RefundEvidence {
  minutesRefunded?: boolean;
  minutesRefundedAt?: string | null;
  minutesRefundedAmount?: number | null;
  minutesRefundRequestedAmount?: number;
  minutesRefundPendingAmount?: number;
  minutesRefundCappedAmount?: number;
}

/** Legacy timestamps alone cannot claim a complete refund if capped/pending evidence exists. */
export function hasFullMinuteRefund(data: RefundEvidence): boolean {
  if ((data.minutesRefundPendingAmount ?? data.minutesRefundCappedAmount ?? 0) > 0) return false;
  if ((data.minutesRefundRequestedAmount ?? 0) > 0) {
    return (data.minutesRefundedAmount ?? 0) >= data.minutesRefundRequestedAmount!;
  }
  return Boolean(data.minutesRefundedAt || data.minutesRefunded);
}
