import type { Expense } from '@/types';
import type { TranslationKey, Lang } from '@/lib/i18n';
import { localeFor } from '@/lib/utils';

/** Preset expense categories stored as stable keys in the DB. */
const PRESET_CATEGORIES = ['rent', 'electricity', 'water', 'transport', 'salaries', 'maintenance', 'equipment', 'other'] as const;

/** Localizes a stored category key; custom categories pass through as-is. */
export function expenseCategoryLabel(category: string, t: (k: TranslationKey) => string): string {
  return (PRESET_CATEGORIES as readonly string[]).includes(category)
    ? t(`expenseCat${category[0].toUpperCase()}${category.slice(1)}` as TranslationKey)
    : category;
}

export type ExpensePeriod = 'week' | 'month' | 'year' | 'custom';

export type ReportPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

/**
 * Returns an inclusive YYYY-MM-DD range for a report period (today, this
 * week Monday-Sunday, this month, this year). Used by every report tab so
 * Sales, Profit, Cashflow, Expenses and Category analytics all share the
 * same date window.
 */
export function reportPeriodRange(period: ReportPeriod, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  switch (period) {
    case 'today': {
      const d = dstr(now);
      return { from: d, to: d };
    }
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const d = dstr(y);
      return { from: d, to: d };
    }
    case 'week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return {
        from: dstr(new Date(now.getFullYear(), now.getMonth(), diff)),
        to: dstr(new Date(now.getFullYear(), now.getMonth(), diff + 6)),
      };
    }
    case 'month': {
      return {
        from: dstr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: dstr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    }
    case 'year': {
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    }
    case 'custom':
      return { from: customFrom || dstr(now), to: customTo || dstr(now) };
  }
}

/** Returns an inclusive local-day range for a report period. */
export function expensePeriodRange(period: ExpensePeriod, customFrom?: Date, customTo?: Date): { from: Date; to: Date } {
  const now = new Date();
  let from: Date;
  let to: Date;
  switch (period) {
    case 'week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      from = new Date(now.getFullYear(), now.getMonth(), diff);
      to = new Date(now.getFullYear(), now.getMonth(), diff + 7, 0, 0, 0, -1);
      break;
    }
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    case 'custom':
      from = customFrom || new Date(now.getFullYear(), now.getMonth(), 1);
      to = customTo || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
  }
  return { from, to };
}

export interface CategoryStat {
  category: string;
  label: string;
  amount: number;
  count: number;
}

export interface MethodStat {
  method: string;
  label: string;
  amount: number;
  count: number;
}

export interface SourceStat {
  source: string;
  label: string;
  amount: number;
  count: number;
}

export interface BreakdownPoint {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface ExpenseStats {
  total: number;
  count: number;
  byCategory: CategoryStat[];
  byMethod: MethodStat[];
  bySource: SourceStat[];
  breakdown: BreakdownPoint[];
  topCategories: CategoryStat[];
  granularity: 'day' | 'week' | 'month';
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  x.setDate(x.getDate() - day + (day === 0 ? -6 : 1));
  return x;
}

/**
 * Aggregates expenses inside an inclusive [from, to] range: total, count,
 * breakdown by category and payment method, a daily/weekly/monthly time
 * series (granularity picked from the span) and the top categories.
 * This is the single calculation used by the Expenses report, the Yearly
 * report and any future dashboard KPI so numbers always agree.
 */
export function computeExpenseStats(
  expenses: Expense[],
  from: Date,
  to: Date,
  lang: Lang,
  t: (k: TranslationKey) => string,
): ExpenseStats {
  const rows = expenses.filter((e) => {
    const d = new Date(e.expense_date || e.created_at || 0);
    return d >= from && d <= to;
  });

  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);

  const catMap: Record<string, { amount: number; count: number }> = {};
  const methodMap: Record<string, { amount: number; count: number }> = {};
  const sourceMap: Record<string, { amount: number; count: number }> = {};
  for (const e of rows) {
    const cat = e.category || 'other';
    catMap[cat] = catMap[cat] || { amount: 0, count: 0 };
    catMap[cat].amount += Number(e.amount || 0);
    catMap[cat].count += 1;
    const m = e.payment_method || 'cash';
    methodMap[m] = methodMap[m] || { amount: 0, count: 0 };
    methodMap[m].amount += Number(e.amount || 0);
    methodMap[m].count += 1;
    const s = e.payment_source || (e.payment_method === 'cash' ? 'cash_register' : 'personal');
    sourceMap[s] = sourceMap[s] || { amount: 0, count: 0 };
    sourceMap[s].amount += Number(e.amount || 0);
    sourceMap[s].count += 1;
  }

  const byCategory: CategoryStat[] = Object.entries(catMap)
    .map(([category, v]) => ({ category, label: expenseCategoryLabel(category, t), amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count);

  const byMethod: MethodStat[] = Object.entries(methodMap)
    .map(([method, v]) => ({ method, label: t(method as TranslationKey), amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  const bySource: SourceStat[] = Object.entries(sourceMap)
    .map(([source, v]) => ({ source, label: t(source === 'cash_register' ? ('paymentSourceRegister' as TranslationKey) : 'paymentSourcePersonal'), amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  // Time series granularity: daily up to ~6 weeks, weekly up to ~10 months,
  // monthly beyond that.
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const granularity: ExpenseStats['granularity'] = spanDays <= 45 ? 'day' : spanDays <= 300 ? 'week' : 'month';

  const buckets: Record<string, { amount: number; count: number }> = {};
  for (const e of rows) {
    const d = new Date(e.expense_date || e.created_at || 0);
    const key = granularity === 'day'
      ? dayKey(d)
      : granularity === 'week'
        ? dayKey(mondayOf(d))
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets[key] = buckets[key] || { amount: 0, count: 0 };
    buckets[key].amount += Number(e.amount || 0);
    buckets[key].count += 1;
  }

  // Build a contiguous, ordered series covering the whole range.
  const breakdown: BreakdownPoint[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    let key: string;
    let label: string;
    if (granularity === 'day') {
      key = dayKey(cursor);
      label = cursor.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' });
    } else if (granularity === 'week') {
      const mon = mondayOf(cursor);
      key = dayKey(mon);
      const next = new Date(mon);
      next.setDate(next.getDate() + 6);
      label = `${mon.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' })} â€“ ${next.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' })}`;
    } else {
      key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      label = cursor.toLocaleDateString(localeFor(lang, 'en'), { month: 'short', year: '2-digit' });
    }
    const v = buckets[key] || { amount: 0, count: 0 };
    breakdown.push({ key, label, amount: v.amount, count: v.count });

    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (granularity === 'week') {
      const nxt = mondayOf(cursor);
      nxt.setDate(nxt.getDate() + 7);
      cursor.setTime(nxt.getTime());
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return { total, count: rows.length, byCategory, byMethod, bySource, breakdown, topCategories: byCategory.slice(0, 5), granularity };
}

export interface ProfitPeriod {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  margin: number;
  salesCount: number;
  expenseCount: number;
}

export interface CashflowTotals {
  /** Actual money received: customer payments (incl. refunds as negatives) + net paid on non-credit sales. */
  cashIn: number;
  /** Actual money paid out: supplier payments + operating expenses. */
  cashOut: number;
  netCashflow: number;
  /** Sum of the payments table (debt collections + credit-sale upfronts, minus cash refunds). */
  customerPayments: number;
  /** Net paid on cash/card/ccp sales (paid - refunds). Refunds of customer-less
   *  cash sales never create payment rows, so the refund must be subtracted here. */
  salesCollected: number;
  supplierPayments: number;
  expenses: number;
}

/**
 * Sums the refunded_amount of non-credit sales that have NO attached customer.
 * These are the only refunds that never produce a negative `payments` row
 * (the refund controller only writes payment rows when a customer is attached),
 * so they must be subtracted from the sales' paid amount manually. Refunds of
 * customer-attached sales already appear as negative rows in the payments
 * table, so subtracting their refunded_amount here would double-count.
 */
export function computeUnpaidCashRefunds(sales: { customer_id?: string | null; refunded_amount?: number | null }[]): number {
  return (sales || [])
    .filter((s) => !s.customer_id)
    .reduce((sum, s) => sum + Number(s.refunded_amount || 0), 0);
}

/**
 * Cashflow uses actual money only:
 *   Cash In  = customer payments (payments table) + net paid on non-credit sales
 *   Cash Out = supplier payments + operating expenses
 *   Net Cashflow = Cash In - Cash Out
 * Credit sales count toward profit but their unpaid part never counts as cash.
 */
export function computeCashflow(args: {
  payments: number;
  salesPaid: number;
  salesRefunded?: number;
  supplierPayments: number;
  expenses: number;
}): CashflowTotals {
  const customerPayments = Number(args.payments) || 0;
  const salesCollected = Math.max(0, (Number(args.salesPaid) || 0) - (Number(args.salesRefunded) || 0));
  const cashIn = customerPayments + salesCollected;
  const supplierPayments = Number(args.supplierPayments) || 0;
  const expenses = Number(args.expenses) || 0;
  const cashOut = supplierPayments + expenses;
  return { cashIn, cashOut, netCashflow: cashIn - cashOut, customerPayments, salesCollected, supplierPayments, expenses };
}

export interface CashflowPoint {
  key: string;
  label: string;
  cashIn: number;
  cashOut: number;
  net: number;
}

/**
 * Buckets actual cash in/out into a daily (<=45d), weekly (<=300d) or
 * monthly series, mirroring the expense breakdown's granularity rules.
 */
export function computeCashflowSeries(args: {
  payments: { created_at: string; amount: number }[];
  sales: { created_at: string; paid: number }[];
  supplierPayments: { created_at: string; amount: number }[];
  expenses: { expense_date: string; amount: number }[];
  from: Date;
  to: Date;
  lang: Lang;
}): CashflowPoint[] {
  const { payments, sales, supplierPayments, expenses, from, to, lang } = args;
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const granularity: 'day' | 'week' | 'month' = spanDays <= 45 ? 'day' : spanDays <= 300 ? 'week' : 'month';

  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mondayOf = (d: Date): Date => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay();
    x.setDate(x.getDate() - day + (day === 0 ? -6 : 1));
    return x;
  };

  const buckets: Record<string, { cashIn: number; cashOut: number }> = {};
  const add = (key: string, cashIn: number, cashOut: number) => {
    const b = buckets[key] || (buckets[key] = { cashIn: 0, cashOut: 0 });
    b.cashIn += cashIn;
    b.cashOut += cashOut;
  };

  for (const p of payments) {
    const d = new Date(p.created_at);
    add(granularity === 'day' ? dayKey(d) : granularity === 'week' ? dayKey(mondayOf(d)) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, Number(p.amount) || 0, 0);
  }
  for (const s of sales) {
    const d = new Date(s.created_at);
    add(granularity === 'day' ? dayKey(d) : granularity === 'week' ? dayKey(mondayOf(d)) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, Number(s.paid) || 0, 0);
  }
  for (const p of supplierPayments) {
    const d = new Date(p.created_at);
    add(granularity === 'day' ? dayKey(d) : granularity === 'week' ? dayKey(mondayOf(d)) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0, Number(p.amount) || 0);
  }
  for (const e of expenses) {
    const d = new Date(e.expense_date);
    add(granularity === 'day' ? dayKey(d) : granularity === 'week' ? dayKey(mondayOf(d)) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0, Number(e.amount) || 0);
  }

  const series: CashflowPoint[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    let key: string;
    let label: string;
    if (granularity === 'day') {
      key = dayKey(cursor);
      label = cursor.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' });
    } else if (granularity === 'week') {
      const mon = mondayOf(cursor);
      key = dayKey(mon);
      const next = new Date(mon);
      next.setDate(next.getDate() + 6);
      label = `${mon.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' })} â€“ ${next.toLocaleDateString(localeFor(lang, 'en'), { day: '2-digit', month: 'short' })}`;
    } else {
      key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      label = cursor.toLocaleDateString(localeFor(lang, 'en'), { month: 'short', year: '2-digit' });
    }
    const b = buckets[key] || { cashIn: 0, cashOut: 0 };
    series.push({ key, label, cashIn: b.cashIn, cashOut: b.cashOut, net: b.cashIn - b.cashOut });

    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (granularity === 'week') {
      const nxt = mondayOf(cursor);
      nxt.setDate(nxt.getDate() + 7);
      cursor.setTime(nxt.getTime());
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return series;
}

/** Revenue and COGS from sale items, using the product's current unit cost. */
export function computeItemsRevenueCogs(
  items: { product_id: string | null; qty: number; refunded_qty?: number | null; sell_as: string; price: number }[],
  costMap: Record<string, { purchase_price_box: number; units_per_box: number }>,
): { revenue: number; cogs: number } {
  let revenue = 0;
  let cogs = 0;
  for (const it of items) {
    const effQty = Number(it.qty) - Number(it.refunded_qty || 0);
    if (effQty <= 0) continue;
    revenue += Number(it.price) * effQty;
    const prod = it.product_id ? costMap[it.product_id] : undefined;
    if (prod) {
      const unitCost = prod.units_per_box > 0 ? prod.purchase_price_box / prod.units_per_box : 0;
      cogs += it.sell_as === 'box' ? Number(prod.purchase_price_box) * effQty : unitCost * effQty;
    }
  }
  return { revenue, cogs };
}

/**
 * Net Sales = completed sales - refunds. The single definition used by the
 * Sales report, the P&L statement, the yearly report and the dashboard KPI
 * so every surface agrees.
 */
export function computeNetSales(sales: { total: number; refunded_amount?: number | null }[]): number {
  return (sales || []).reduce((s, r) => s + Number(r.total) - Number(r.refunded_amount || 0), 0);
}

/**
 * Order-level discounts net of refunds. A fully refunded sale contributes no
 * discount; a partially refunded one contributes a proportional share, so
 * Gross Sales (= Net Sales + Discounts) stays consistent with Net Sales.
 * Discounts are NOT expenses and never affect COGS â€” they only reduce the
 * gross sales figure.
 */
export function computeSaleDiscounts(sales: { total: number; discount: number; refunded_amount?: number | null }[]): number {
  return (sales || []).reduce((s, r) => {
    const total = Number(r.total) || 0;
    if (total <= 0) return s;
    const ratio = Math.max(0, (total - Number(r.refunded_amount || 0)) / total);
    return s + (Number(r.discount) || 0) * ratio;
  }, 0);
}

/**
 * Assembles the agreed P&L structure:
 *   Revenue - COGS = Gross Profit; Gross Profit - Expenses = Net Profit.
 */
export function computeProfitPeriod(args: {
  revenue: number;
  cogs: number;
  expenses: number;
  salesCount: number;
  expenseCount: number;
}): ProfitPeriod {
  const grossProfit = args.revenue - args.cogs;
  const netProfit = grossProfit - args.expenses;
  return {
    revenue: args.revenue,
    cogs: args.cogs,
    grossProfit,
    expenses: args.expenses,
    netProfit,
    margin: args.revenue > 0 ? (grossProfit / args.revenue) * 100 : 0,
    salesCount: args.salesCount,
    expenseCount: args.expenseCount,
  };
}
