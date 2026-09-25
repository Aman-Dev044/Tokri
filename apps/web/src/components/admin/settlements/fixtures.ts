/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Covers `/admin/settlements` and `/admin/ledger`. Shown only behind the amber
 * banner when those endpoints cannot be reached.
 *
 * ── THE ARITHMETIC MUST RECONCILE ──────────────────────────────────────────
 * Every row below satisfies, exactly, in integer paise:
 *
 *     grossSalesPaise − totalCommissionPaise − refundsPaise = netPayablePaise
 *
 * and the ledger entries for a settlement sum to the same net. That is not
 * decoration: a settlement view whose numbers do not add up teaches an admin
 * to stop trusting the page, and a fixture that does not add up teaches the
 * same lesson before the API even ships.
 */

export type SettlementStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface SettlementRow {
  id: string;
  vendorId: string;
  vendorName: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  grossSalesPaise: number;
  totalCommissionPaise: number;
  refundsPaise: number;
  netPayablePaise: number;
  commissionPct: number;
  status: SettlementStatus;
  paidAt: string | null;
  reference: string | null;
}

export type LedgerType = 'sale' | 'commission' | 'refund' | 'payout' | 'adjustment';

export interface LedgerEntryRow {
  id: string;
  type: LedgerType;
  /** SIGNED, in paise: credits positive, debits negative. */
  amountPaise: number;
  orderId: string | null;
  orderNo: string | null;
  note: string | null;
  createdAt: string;
}

export interface SettlementDetail extends SettlementRow {
  entries: LedgerEntryRow[];
}

/** gross − commission − refunds, computed so a fixture can never drift. */
function net(gross: number, commission: number, refunds: number): number {
  return gross - commission - refunds;
}

export const SETTLEMENTS_FIXTURE: readonly SettlementRow[] = [
  {
    id: 'stl_01',
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    periodStart: '2026-09-08T00:00:00+05:30',
    periodEnd: '2026-09-14T23:59:59+05:30',
    orderCount: 412,
    grossSalesPaise: 48_62_400,
    totalCommissionPaise: 7_29_360,
    refundsPaise: 1_26_800,
    netPayablePaise: net(48_62_400, 7_29_360, 1_26_800),
    commissionPct: 15,
    status: 'paid',
    paidAt: '2026-09-16T11:04:00+05:30',
    reference: 'UTR2026091600418823',
  },
  {
    id: 'stl_02',
    vendorId: 'ven_07',
    vendorName: 'Sahyadri Kirana',
    periodStart: '2026-09-08T00:00:00+05:30',
    periodEnd: '2026-09-14T23:59:59+05:30',
    orderCount: 268,
    grossSalesPaise: 29_14_700,
    totalCommissionPaise: 3_49_764,
    refundsPaise: 42_300,
    netPayablePaise: net(29_14_700, 3_49_764, 42_300),
    commissionPct: 12,
    status: 'paid',
    paidAt: '2026-09-16T11:04:00+05:30',
    reference: 'UTR2026091600418824',
  },
  {
    id: 'stl_03',
    vendorId: 'ven_09',
    vendorName: 'Jubilee Daily Needs',
    periodStart: '2026-09-15T00:00:00+05:30',
    periodEnd: '2026-09-21T23:59:59+05:30',
    orderCount: 331,
    grossSalesPaise: 37_88_150,
    totalCommissionPaise: 5_30_341,
    refundsPaise: 0,
    netPayablePaise: net(37_88_150, 5_30_341, 0),
    commissionPct: 14,
    status: 'processing',
    paidAt: null,
    reference: null,
  },
  {
    id: 'stl_04',
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    periodStart: '2026-09-15T00:00:00+05:30',
    periodEnd: '2026-09-21T23:59:59+05:30',
    orderCount: 455,
    grossSalesPaise: 52_07_900,
    totalCommissionPaise: 7_81_185,
    refundsPaise: 2_18_450,
    netPayablePaise: net(52_07_900, 7_81_185, 2_18_450),
    commissionPct: 15,
    status: 'pending',
    paidAt: null,
    reference: null,
  },
  {
    id: 'stl_05',
    vendorId: 'ven_13',
    vendorName: 'T. Nagar Grocers',
    periodStart: '2026-09-15T00:00:00+05:30',
    periodEnd: '2026-09-21T23:59:59+05:30',
    orderCount: 194,
    grossSalesPaise: 21_46_600,
    totalCommissionPaise: 2_79_058,
    refundsPaise: 31_900,
    netPayablePaise: net(21_46_600, 2_79_058, 31_900),
    commissionPct: 13,
    status: 'pending',
    paidAt: null,
    reference: null,
  },
  {
    id: 'stl_06',
    vendorId: 'ven_11',
    vendorName: 'Park Street Provisions',
    periodStart: '2026-09-15T00:00:00+05:30',
    periodEnd: '2026-09-21T23:59:59+05:30',
    orderCount: 122,
    grossSalesPaise: 13_02_450,
    totalCommissionPaise: 1_82_343,
    refundsPaise: 1_48_200,
    netPayablePaise: net(13_02_450, 1_82_343, 1_48_200),
    commissionPct: 14,
    status: 'failed',
    paidAt: null,
    reference: 'UTR2026092200419102',
  },
  {
    id: 'stl_07',
    vendorId: 'ven_05',
    vendorName: 'Marine Drive Mart',
    periodStart: '2026-09-15T00:00:00+05:30',
    periodEnd: '2026-09-21T23:59:59+05:30',
    orderCount: 87,
    grossSalesPaise: 9_74_300,
    totalCommissionPaise: 1_46_145,
    refundsPaise: 0,
    netPayablePaise: net(9_74_300, 1_46_145, 0),
    commissionPct: 15,
    status: 'pending',
    paidAt: null,
    reference: null,
  },
];

export function settlementDetailFixture(id: string): SettlementDetail {
  const base =
    SETTLEMENTS_FIXTURE.find((s) => s.id === id) ??
    SETTLEMENTS_FIXTURE[0] ??
    ({
      id,
      vendorId: '',
      vendorName: 'Unknown vendor',
      periodStart: '2026-09-15T00:00:00+05:30',
      periodEnd: '2026-09-21T23:59:59+05:30',
      orderCount: 0,
      grossSalesPaise: 0,
      totalCommissionPaise: 0,
      refundsPaise: 0,
      netPayablePaise: 0,
      commissionPct: 0,
      status: 'pending',
      paidAt: null,
      reference: null,
    } satisfies SettlementRow);

  /*
   * Five representative sale/commission pairs plus the refunds, scaled so the
   * entries sum to exactly the settlement's net. The remainder from the
   * integer division is pushed onto the last pair, so nothing is lost to
   * rounding — which is the whole reason money is stored in paise.
   */
  const pairs = 5;
  const salePer = Math.floor(base.grossSalesPaise / pairs);
  const commissionPer = Math.floor(base.totalCommissionPaise / pairs);
  const saleRemainder = base.grossSalesPaise - salePer * pairs;
  const commissionRemainder = base.totalCommissionPaise - commissionPer * pairs;

  const entries: LedgerEntryRow[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const last = i === pairs - 1;
    const orderNo = `MND-2026091${5 + i}-0${100 + i * 37}`;
    entries.push({
      id: `led_${base.id}_s${i}`,
      type: 'sale',
      amountPaise: salePer + (last ? saleRemainder : 0),
      orderId: `ord_${9000 + i}`,
      orderNo,
      note: null,
      createdAt: `2026-09-1${5 + i}T12:0${i}:00+05:30`,
    });
    entries.push({
      id: `led_${base.id}_c${i}`,
      type: 'commission',
      amountPaise: -(commissionPer + (last ? commissionRemainder : 0)),
      orderId: `ord_${9000 + i}`,
      orderNo,
      note: `${base.commissionPct}% platform commission, snapshotted at order creation`,
      createdAt: `2026-09-1${5 + i}T12:0${i}:01+05:30`,
    });
  }

  if (base.refundsPaise > 0) {
    entries.push({
      id: `led_${base.id}_r0`,
      type: 'refund',
      amountPaise: -base.refundsPaise,
      orderId: 'ord_9040',
      orderNo: 'MND-20260923-0612',
      note: 'Customer refund, debited back from the vendor',
      createdAt: '2026-09-20T19:44:00+05:30',
    });
  }

  return { ...base, id, entries };
}

/** Sums a ledger. The settlement's `netPayablePaise` must equal this exactly. */
export function ledgerNet(entries: readonly LedgerEntryRow[]): number {
  return entries.reduce((sum, entry) => sum + entry.amountPaise, 0);
}

export const LEDGER_TYPE_LABEL: Readonly<Record<LedgerType, string>> = {
  sale: 'Sale',
  commission: 'Commission',
  refund: 'Refund',
  payout: 'Payout',
  adjustment: 'Adjustment',
};
