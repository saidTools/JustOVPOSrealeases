import type { Purchase, SupplierPayment } from '@/types';

export interface SupplierAccount {
  totalPurchases: number;
  totalPaid: number;
  remaining: number;
  invoiceCount: number;
}

/**
 * Computes each supplier's account from actual purchase + supplier_payment
 * transactions, never from a manually maintained balance column.
 *   totalPurchases = sum of purchases.total
 *   totalPaid      = sum of purchases.paid (equals recorded supplier_payments)
 *   remaining      = totalPurchases - totalPaid
 */
export function computeSupplierAccounts(
  purchases: Pick<Purchase, 'supplier_id' | 'total' | 'paid' | 'remaining'>[],
): Record<string, SupplierAccount> {
  const map: Record<string, SupplierAccount> = {};
  for (const p of purchases) {
    if (!p.supplier_id) continue;
    const total = Number(p.total) || 0;
    const paid = Number(p.paid) || 0;
    const remaining = Math.max(0, total - paid);
    const acc = map[p.supplier_id] || { totalPurchases: 0, totalPaid: 0, remaining: 0, invoiceCount: 0 };
    acc.totalPurchases += total;
    acc.totalPaid += paid;
    acc.remaining += remaining;
    acc.invoiceCount += 1;
    map[p.supplier_id] = acc;
  }
  return map;
}

export type SupplierTransactionType = 'purchase' | 'payment';

export interface SupplierTransaction {
  key: string;
  type: SupplierTransactionType;
  date: string;
  amount: number;
  paid: number;
  remaining: number;
  invoice: string | null;
  notes: string | null;
  userId: string | null;
  source?: string | null;
}

/**
 * Merges purchases and supplier_payments into a chronological supplier
 * statement, newest first. For payment rows the remaining column is the
 * supplier running balance after that payment; for purchase rows it is the
 * invoice's current remaining.
 */
export function buildSupplierStatement(
  purchases: Pick<Purchase, 'id' | 'invoice_number' | 'total' | 'paid' | 'remaining' | 'notes' | 'user_id' | 'created_at'>[],
  payments: Pick<SupplierPayment, 'id' | 'amount' | 'payment_source' | 'notes' | 'user_id' | 'created_at'>[],
): SupplierTransaction[] {
  type EventData = Purchase | SupplierPayment;
  type Event = { key: string; type: SupplierTransactionType; date: string; amount: number; order: number; data: EventData };
  const events: Event[] = [
    ...purchases.map((x) => ({
      key: `p-${x.id}`, type: 'purchase' as const, date: x.created_at || new Date().toISOString(),
      amount: Number(x.total) || 0, order: new Date(x.created_at || 0).getTime(), data: x as Purchase,
    })),
    ...payments.map((x) => ({
      key: `d-${x.id}`, type: 'payment' as const, date: x.created_at || new Date().toISOString(),
      amount: Number(x.amount) || 0, order: new Date(x.created_at || 0).getTime(), data: x as SupplierPayment,
    })),
  ].sort((a, b) => a.order - b.order);

  let running = 0;
  const out: SupplierTransaction[] = [];

  for (const e of events) {
    if (e.type === 'purchase') {
      const x = e.data as Purchase;
      const total = e.amount;
      const paid = Number(x.paid) || 0;
      const rem = Number(x.remaining);
      const remaining = Number.isFinite(rem) && rem >= 0 ? rem : Math.max(0, total - paid);
      running += total;
      out.push({
        key: e.key, type: 'purchase', date: e.date, amount: total, paid, remaining,
        invoice: x.invoice_number ?? null, notes: x.notes ?? null, userId: x.user_id ?? null,
      });
    } else {
      const amount = e.amount;
      running -= amount;
      out.push({
        key: e.key, type: 'payment', date: e.date, amount, paid: amount,
        remaining: Math.max(0, running),
        invoice: null, notes: e.data.notes ?? null, userId: e.data.user_id ?? null,
        source: (e.data as SupplierPayment).payment_source ?? null,
      });
    }
  }

  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

