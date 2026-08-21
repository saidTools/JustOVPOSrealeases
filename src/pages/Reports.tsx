import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, ShoppingBag, Package, Users, Truck, Wallet, ArrowUp, ArrowDown, BarChart3, Boxes, Download, Eye, PieChart, AlertTriangle } from 'lucide-react';
import type { Sale, SaleItem, Purchase, Product, Customer, Supplier, Expense } from '@/types';
import type { Lang, TranslationKey } from '@/lib/i18n';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { formatMoney, formatNumber, formatDate, formatDateTime, todayRange, monthRange, localeFor } from '@/lib/utils';
import { BarChart, DonutChart } from '@/components/Charts';
import { computeSupplierAccounts } from '@/lib/supplierAccount';
import { getRefundCapability, getExpenseCapability } from '@/lib/schema';
import { computeExpenseStats, computeItemsRevenueCogs, computeProfitPeriod, reportPeriodRange, computeNetSales, computeSaleDiscounts, computeCashflow, computeCashflowSeries, computeUnpaidCashRefunds, type ReportPeriod, type ExpenseStats, type CashflowTotals, type CashflowPoint } from '@/lib/reporting';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';

type ReportTab = 'sales' | 'purchases' | 'inventory' | 'profit' | 'categories' | 'customers' | 'suppliers' | 'debts' | 'top' | 'cashflow' | 'expenses' | 'yearly';

// Profit / cashflow / expense / yearly analytics are financial data: only
// shown when the user holds reports_financial (admin always does).
const FINANCIAL_TABS: ReportTab[] = ['profit', 'cashflow', 'expenses', 'yearly'];

interface YearlyReport {
  year: number;
  legacy: boolean;
  months: { key: string; label: string; revenue: number; discounts: number; cogs: number; gross: number; expenses: number; net: number; salesCount: number; expenseCount: number }[];
  totalSales: number;
  discounts: number;
  grossSales: number;
  totalCogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  salesCount: number;
  expenseCount: number;
  byCategory: { category: string; label: string; amount: number; count: number }[];
}

interface CategoryPerf {
  category_id: string;
  name: string;
  name_ar: string | null;
  products: number;
  purchases_amount: number;
  units_purchased: number;
  sales_revenue: number;
  units_sold: number;
  cogs: number;
  gross_profit: number;
  margin: number;
}

export default function Reports() {
  const { t, lang, settings, canFinance } = useApp();
  const [tab, setTab] = useState<ReportTab>('sales');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [from, setFrom] = useState(monthRange().from.slice(0, 10));
  const [to, setTo] = useState(monthRange().to.slice(0, 10));
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [viewItems, setViewItems] = useState<SaleItem[]>([]);
  const [catSort, setCatSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'revenue', dir: 'desc' });
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const cur = settings?.currency || 'DA';

  // If the current tab is financial and the user no longer has the financial
  // permission, fall back to the sales tab (covers permission changes).
  useEffect(() => {
    if (!canFinance() && FINANCIAL_TABS.includes(tab)) {
      setTab('sales');
    }
  }, [canFinance, tab]);

  const applyPeriod = useCallback((p: ReportPeriod) => {
    setPeriod(p);
    if (p === 'custom') return;
    const r = reportPeriodRange(p);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const openReceipt = useCallback(async (sale: Sale) => {
    setViewSale(sale);
    setViewItems([]);
    const { data: items } = await supabase.from('sale_items').select('*').eq('sale_id', sale.id);
    setViewItems((items || []) as SaleItem[]);
  }, []);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, year]);

  const loadReport = async () => {
    setLoading(true);
    const today = todayRange();
    const month = monthRange();
    const rangeFrom = from ? new Date(`${from}T00:00:00`).toISOString() : month.from;
    const rangeTo = to ? new Date(`${to}T23:59:59`).toISOString() : month.to;
    const refundReady = (await getRefundCapability()) === 'full';
    // `discount` is always selected so the P&L can show Gross Sales / Discounts
    // / Net Sales separately (discounts are never counted as expenses).
    const salesSelect = refundReady ? 'total, discount, refunded_amount' : 'total, discount';
    const result: Record<string, unknown> = {};

    if (tab === 'sales') {
      const { data: sales } = await supabase.from('sales').select('*, customer:customers(*)').eq('status', 'completed').gte('created_at', rangeFrom).lte('created_at', rangeTo).order('created_at', { ascending: false }).limit(200);
      const { data: todaySales } = await supabase.from('sales').select(salesSelect).gte('created_at', today.from).lt('created_at', today.to).eq('status', 'completed');
      const { data: rangeSales } = await supabase.from('sales').select(salesSelect).gte('created_at', rangeFrom).lte('created_at', rangeTo).eq('status', 'completed');
      const [payRes, todayPayRes, cashSalesRes, todayCashSalesRes] = await Promise.all([
        supabase.from('payments').select('amount, created_at').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('payments').select('amount, created_at').gte('created_at', today.from).lt('created_at', today.to),
        // Cash queries must include refunded sales (status flips to 'refunded'
        // on full refunds): their `paid` was real money received and refunds
        // net out via negative payment rows / refunded_amount below.
        supabase.from('sales').select(refundReady ? 'paid, refunded_amount, customer_id, created_at' : 'paid, customer_id, created_at').neq('status', 'held').neq('payment_method', 'credit').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('sales').select(refundReady ? 'paid, refunded_amount, customer_id, created_at' : 'paid, customer_id, created_at').neq('status', 'held').neq('payment_method', 'credit').gte('created_at', today.from).lt('created_at', today.to),
      ]);
      result.sales = sales || [];
      const sumPay = (rows: { amount: number }[] | null | undefined) => (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const sumPaid = (rows: { paid: number }[] | null | undefined) => (rows || []).reduce((s, r) => s + Number(r.paid || 0), 0);
      result.todayTotal = computeNetSales((todaySales || []) as { total: number; refunded_amount: number | null }[]);
      result.rangeTotal = computeNetSales((rangeSales || []) as { total: number; refunded_amount: number | null }[]);
      result.todayDiscounts = computeSaleDiscounts((todaySales || []) as { total: number; discount: number; refunded_amount: number | null }[]);
      result.rangeDiscounts = computeSaleDiscounts((rangeSales || []) as { total: number; discount: number; refunded_amount: number | null }[]);
      // Only customer-less cash-sale refunds are subtracted here; refunds of
      // customer-attached sales already appear as negative payment rows.
      result.todayCash = computeCashflow({ payments: sumPay(todayPayRes.data), salesPaid: sumPaid(todayCashSalesRes.data), salesRefunded: refundReady ? computeUnpaidCashRefunds(todayCashSalesRes.data as { customer_id?: string | null; refunded_amount?: number | null }[]) : 0, supplierPayments: 0, expenses: 0 }).cashIn;
      result.rangeCash = computeCashflow({ payments: sumPay(payRes.data), salesPaid: sumPaid(cashSalesRes.data), salesRefunded: refundReady ? computeUnpaidCashRefunds(cashSalesRes.data as { customer_id?: string | null; refunded_amount?: number | null }[]) : 0, supplierPayments: 0, expenses: 0 }).cashIn;
    } else if (tab === 'purchases') {
      const { data: purchases } = await supabase.from('purchases').select('*, supplier:suppliers(*)').gte('created_at', rangeFrom).lte('created_at', rangeTo).order('created_at', { ascending: false }).limit(200);
      result.purchases = purchases || [];
    } else if (tab === 'inventory') {
      const { data: products } = await supabase.from('products').select('*, category:categories(*)').order('name');
      const totalValue = (products || []).reduce((s: number, p: { current_stock: number; purchase_price_box: number; units_per_box: number }) => {
        const unitCost = p.units_per_box > 0 ? p.purchase_price_box / p.units_per_box : 0;
        return s + unitCost * Number(p.current_stock);
      }, 0);
      result.products = products || [];
      result.totalValue = totalValue;
    } else if (tab === 'profit') {
      const { data: sales } = await supabase.from('sales').select('id').eq('status', 'completed').gte('created_at', rangeFrom).lte('created_at', rangeTo);
      const ids = (sales || []).map((s: { id: string }) => s.id);
      // Net Sales = completed sales - refunds (invoice-based, same as the
      // Sales report and Dashboard KPI). COGS stays item-based and refund-aware.
      const { data: rangeSales } = await supabase.from('sales').select(salesSelect).eq('status', 'completed').gte('created_at', rangeFrom).lte('created_at', rangeTo);
      const revenue = computeNetSales((rangeSales || []) as { total: number; refunded_amount: number | null }[]);
      // P&L structure: Gross Sales - Discounts = Net Sales; Net Sales - COGS
      // = Gross Profit; Gross Profit - Expenses = Net Profit. Discounts reduce
      // profit but are NEVER counted as expenses or COGS.
      const discounts = computeSaleDiscounts((rangeSales || []) as { total: number; discount: number; refunded_amount: number | null }[]);
      const grossSales = revenue + discounts;
      let cost = 0;
      if (ids.length > 0) {
        const itemSelect = refundReady ? `product_id, qty, refunded_qty, sell_as, price` : `product_id, qty, sell_as, price`;
        const [{ data: items }, { data: prods }] = await Promise.all([
          supabase.from('sale_items').select(itemSelect).in('sale_id', ids),
          supabase.from('products').select('id, purchase_price_box, units_per_box'),
        ]);
        const costMap: Record<string, { purchase_price_box: number; units_per_box: number }> = {};
        (prods || []).forEach((p: { id?: string; purchase_price_box: number; units_per_box: number }) => {
          if (p.id) costMap[p.id] = { purchase_price_box: p.purchase_price_box, units_per_box: p.units_per_box };
        });
        const allItems = (items || []) as unknown as { product_id: string | null; qty: number; refunded_qty: number | null; sell_as: string; price: number }[];
        cost = computeItemsRevenueCogs(allItems, costMap).cogs;
      }
      // Operating expenses reduce gross profit to net profit (expenses are
      // never counted as COGS/product purchases).
      let expenseTotal = 0;
      if ((await getExpenseCapability()) !== 'legacy') {
        const { data: expenses } = await supabase.from('expenses').select('amount, expense_date').gte('expense_date', rangeFrom).lte('expense_date', rangeTo);
        expenseTotal = ((expenses || []) as { amount: number }[]).reduce((s: number, e: { amount: number }) => s + Number(e.amount || 0), 0);
      }
      result.revenue = revenue; result.discounts = discounts; result.grossSales = grossSales;
      result.cost = cost; result.profit = revenue - cost;
      result.grossProfit = revenue - cost;
      result.expenses = expenseTotal;
      result.netProfit = revenue - cost - expenseTotal;
    } else if (tab === 'expenses') {
      if ((await getExpenseCapability()) === 'legacy') {
        result.expenseLegacy = true;
      } else {
        const { data: expenses } = await supabase.from('expenses').select('*');
        result.expenseStats = computeExpenseStats(
          (expenses || []) as Expense[],
          new Date(`${from}T00:00:00`),
          new Date(`${to}T23:59:59.999`),
          lang,
          t,
        );
      }
    } else if (tab === 'yearly') {
      const legacy = (await getExpenseCapability()) === 'legacy';
      const yFrom = new Date(year, 0, 1).toISOString();
      const yTo = new Date(year + 1, 0, 1).toISOString();
      const { data: sales } = await supabase.from('sales').select(refundReady ? 'id, created_at, total, discount, refunded_amount' : 'id, created_at, total, discount').eq('status', 'completed').gte('created_at', yFrom).lt('created_at', yTo);
      const saleRows = (sales || []) as { id: string; created_at: string; total: number; discount: number; refunded_amount?: number | null }[];
      const saleMonth: Record<string, number> = {};
      const monthAgg = Array.from({ length: 12 }, () => ({ revenue: 0, discounts: 0, cogs: 0, salesCount: 0 }));
      for (const s of saleRows) {
        const m = new Date(s.created_at).getMonth();
        saleMonth[s.id] = m;
        monthAgg[m].salesCount += 1;
        monthAgg[m].revenue += Number(s.total) - Number(s.refunded_amount || 0);
        const total = Number(s.total) || 0;
        const ratio = total > 0 ? Math.max(0, (total - Number(s.refunded_amount || 0)) / total) : 0;
        monthAgg[m].discounts += (Number(s.discount) || 0) * ratio;
      }
      const ids = saleRows.map((s) => s.id);
      if (ids.length > 0) {
        const itemSelect = refundReady ? 'sale_id, product_id, qty, refunded_qty, sell_as, price' : 'sale_id, product_id, qty, sell_as, price';
        const [{ data: items }, { data: prods }] = await Promise.all([
          supabase.from('sale_items').select(itemSelect).in('sale_id', ids),
          supabase.from('products').select('id, purchase_price_box, units_per_box'),
        ]);
        const costMap: Record<string, { purchase_price_box: number; units_per_box: number }> = {};
        (prods || []).forEach((p: { id?: string; purchase_price_box: number; units_per_box: number }) => { if (p.id) costMap[p.id] = p; });
        const allItems = (items || []) as unknown as { sale_id: string; product_id: string | null; qty: number; refunded_qty: number | null; sell_as: string; price: number }[];
        for (let m = 0; m < 12; m++) {
          monthAgg[m].cogs = computeItemsRevenueCogs(allItems.filter((it) => saleMonth[it.sale_id] === m), costMap).cogs;
        }
      }
      const expRes = await supabase.from('expenses').select('*');
      const expenseStats = legacy
        ? null
        : computeExpenseStats((expRes.data || []) as Expense[], new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59, 999), lang, t);
      const byKey: Record<string, { revenue: number; discounts: number; cogs: number; expenses: number; salesCount: number; expenseCount: number }> = {};
      monthAgg.forEach((m, i) => {
        const key = `${year}-${String(i + 1).padStart(2, '0')}`;
        byKey[key] = { revenue: m.revenue, discounts: m.discounts, cogs: m.cogs, expenses: 0, salesCount: m.salesCount, expenseCount: 0 };
      });
      if (expenseStats) {
        for (const p of expenseStats.breakdown) {
          const agg = byKey[p.key];
          if (agg) { agg.expenses = p.amount; agg.expenseCount = p.count; }
        }
      }
      const totals = computeProfitPeriod({
        revenue: monthAgg.reduce((s, m) => s + m.revenue, 0),
        cogs: monthAgg.reduce((s, m) => s + m.cogs, 0),
        expenses: expenseStats?.total ?? 0,
        salesCount: saleRows.length,
        expenseCount: expenseStats?.count ?? 0,
      });
      result.yearly = {
        year,
        legacy,
        months: Object.keys(byKey).map((key) => {
          const agg = byKey[key];
          const gross = agg.revenue - agg.cogs;
          return {
            key,
            label: new Date(year, Number(key.slice(5)) - 1, 1).toLocaleDateString(localeFor(lang, 'en'), { month: 'short' }),
            revenue: agg.revenue,
            discounts: agg.discounts,
            cogs: agg.cogs,
            gross,
            expenses: agg.expenses,
            net: gross - agg.expenses,
            salesCount: agg.salesCount,
            expenseCount: agg.expenseCount,
          };
        }),
        totalSales: totals.revenue,
        discounts: monthAgg.reduce((s, m) => s + m.discounts, 0),
        grossSales: totals.revenue + monthAgg.reduce((s, m) => s + m.discounts, 0),
        totalCogs: totals.cogs,
        grossProfit: totals.grossProfit,
        totalExpenses: totals.expenses,
        netProfit: totals.netProfit,
        salesCount: totals.salesCount,
        expenseCount: totals.expenseCount,
        byCategory: expenseStats?.byCategory ?? [],
      } as YearlyReport;
    } else if (tab === 'categories') {
      const [catRes, prodRes] = await Promise.all([
        supabase.from('categories').select('id, name, name_ar').order('name'),
        supabase.from('products').select('id, category_id, units_per_box, purchase_price_box'),
      ]);
      const cats = (catRes.data || []) as { id: string; name: string; name_ar: string | null }[];
      const productRows = (prodRes.data || []) as { id: string; category_id: string | null; units_per_box: number; purchase_price_box: number }[];
      const prodMap: Record<string, { category_id: string | null; units_per_box: number; purchase_price_box: number }> = {};
      const catProducts: Record<string, number> = {};
      for (const pr of productRows) {
        prodMap[pr.id] = { category_id: pr.category_id, units_per_box: pr.units_per_box, purchase_price_box: pr.purchase_price_box };
        const cid = pr.category_id || '';
        catProducts[cid] = (catProducts[cid] || 0) + 1;
      }

      const [saleIdsRes, purchaseIdsRes] = await Promise.all([
        supabase.from('sales').select('id').eq('status', 'completed').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('purchases').select('id').gte('created_at', rangeFrom).lte('created_at', rangeTo),
      ]);
      const saleIds = (saleIdsRes.data || []).map((s: { id: string }) => s.id);
      const purchaseIds = (purchaseIdsRes.data || []).map((p: { id: string }) => p.id);

      const perf: Record<string, { revenue: number; unitsSold: number; cogs: number; purchasesAmount: number; unitsPurchased: number }> = {};

      if (saleIds.length > 0) {
        const itemSelect = refundReady ? 'product_id, qty, refunded_qty, sell_as, price' : 'product_id, qty, sell_as, price';
        const { data: items } = await supabase.from('sale_items').select(itemSelect).in('sale_id', saleIds);
        for (const it of (items || []) as unknown as { product_id: string | null; qty: number; refunded_qty: number | null; sell_as: string; price: number }[]) {
          const effQty = Number(it.qty) - Number(it.refunded_qty || 0);
          if (effQty <= 0) continue;
          const prod = it.product_id ? prodMap[it.product_id] : undefined;
          const row = perf[prod?.category_id ?? ''] || (perf[prod?.category_id ?? ''] = { revenue: 0, unitsSold: 0, cogs: 0, purchasesAmount: 0, unitsPurchased: 0 });
          const upb = prod?.units_per_box ?? 1;
          const unitCost = upb > 0 ? (prod?.purchase_price_box ?? 0) / upb : 0;
          row.revenue += Number(it.price) * effQty;
          row.unitsSold += effQty * (it.sell_as === 'box' ? upb : 1);
          row.cogs += it.sell_as === 'box' ? (prod?.purchase_price_box ?? 0) * effQty : unitCost * effQty;
        }
      }

      if (purchaseIds.length > 0) {
        const { data: items } = await supabase.from('purchase_items').select('product_id, qty_boxes, qty_loose_units, units_per_box, subtotal').in('purchase_id', purchaseIds);
        for (const it of (items || []) as unknown as { product_id: string | null; qty_boxes: number; qty_loose_units?: number; units_per_box: number; subtotal: number }[]) {
          const prod = it.product_id ? prodMap[it.product_id] : undefined;
          const row = perf[prod?.category_id ?? ''] || (perf[prod?.category_id ?? ''] = { revenue: 0, unitsSold: 0, cogs: 0, purchasesAmount: 0, unitsPurchased: 0 });
          row.purchasesAmount += Number(it.subtotal);
          row.unitsPurchased += Number(it.qty_boxes) * Number(it.units_per_box || 1) + Number(it.qty_loose_units || 0);
        }
      }

      const allCatIds = new Set([...Object.keys(perf), ...Object.keys(catProducts)]);
      result.categories = [...allCatIds].map((cid) => {
        const cat = cats.find((c) => c.id === cid);
        const p = perf[cid] || { revenue: 0, unitsSold: 0, cogs: 0, purchasesAmount: 0, unitsPurchased: 0 };
        const grossProfit = p.revenue - p.cogs;
        return {
          category_id: cid,
          name: cat ? cat.name : t('uncategorized'),
          name_ar: cat?.name_ar ?? null,
          products: catProducts[cid] || 0,
          purchases_amount: p.purchasesAmount,
          units_purchased: p.unitsPurchased,
          sales_revenue: p.revenue,
          units_sold: p.unitsSold,
          cogs: p.cogs,
          gross_profit: grossProfit,
          margin: p.revenue > 0 ? (grossProfit / p.revenue) * 100 : 0,
        };
      }) as CategoryPerf[];
    } else if (tab === 'customers') {
      const { data: customers } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
      result.customers = customers || [];
    } else if (tab === 'suppliers') {
      const [supRes, purRes] = await Promise.all([
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchases').select('supplier_id, total, paid, remaining'),
      ]);
      result.suppliers = supRes.data || [];
      result.supplierAccounts = computeSupplierAccounts((purRes.data || []) as Purchase[]);
    } else if (tab === 'debts') {
      const { data: debts } = await supabase.from('customers').select('*').gt('balance', 0).order('balance', { ascending: false });
      result.debts = debts || [];
      result.totalDebt = (debts || []).reduce((s: number, c: { balance: number }) => s + Number(c.balance), 0);
    } else if (tab === 'top') {
      const { data: items } = await supabase.from('sale_items').select(refundReady ? 'name, qty, refunded_qty, price, subtotal, sale:sales(status, created_at)' : 'name, qty, price, subtotal, sale:sales(status, created_at)').gte('created_at', rangeFrom).lte('created_at', rangeTo).order('created_at', { ascending: false }).limit(1000);
      const agg: Record<string, { qty: number; revenue: number }> = {};
      ((items || []) as unknown as { name: string; qty: number; refunded_qty: number | null; subtotal: number; sale?: { status: string } | null }[]).forEach((it) => {
        if (it.sale && it.sale.status !== 'completed') return;
        const effQty = Number(it.qty) - Number(it.refunded_qty || 0);
        if (effQty <= 0) return;
        if (!agg[it.name]) agg[it.name] = { qty: 0, revenue: 0 };
        agg[it.name].qty += effQty;
        agg[it.name].revenue += Number(it.subtotal) * (effQty / Number(it.qty));
      });
      result.top = Object.entries(agg).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
    } else if (tab === 'cashflow') {
      // Actual money only: Cash In = customer payments + paid portion of
      // non-credit sales; Cash Out = supplier payments + operating expenses.
      const [payRes, cashSalesRes, supPayRes, expRes] = await Promise.all([
        supabase.from('payments').select('amount, created_at').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('sales').select(refundReady ? 'paid, refunded_amount, customer_id, created_at' : 'paid, customer_id, created_at').neq('status', 'held').neq('payment_method', 'credit').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('supplier_payments').select('amount, created_at').eq('payment_source', 'cash_register').gte('created_at', rangeFrom).lte('created_at', rangeTo),
        supabase.from('expenses').select('amount, expense_date').eq('payment_source', 'cash_register').gte('expense_date', rangeFrom).lte('expense_date', rangeTo),
      ]);
      const sumAmt = (rows: { amount: number }[] | null | undefined) => (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const sumPaid = (rows: { paid: number }[] | null | undefined) => (rows || []).reduce((s, r) => s + Number(r.paid || 0), 0);
      result.cashflow = computeCashflow({
        payments: sumAmt(payRes.data),
        salesPaid: sumPaid(cashSalesRes.data),
        // Only customer-less cash-sale refunds are subtracted here; refunds of
        // customer-attached sales already appear as negative payment rows.
        salesRefunded: refundReady ? computeUnpaidCashRefunds(cashSalesRes.data as { customer_id?: string | null; refunded_amount?: number | null }[]) : 0,
        supplierPayments: sumAmt(supPayRes.data),
        expenses: sumAmt(expRes.data),
      });
      const cashSalesRows = (cashSalesRes.data || []) as { created_at: string; paid: number; refunded_amount?: number | null; customer_id?: string | null }[];
      result.cashflowSeries = computeCashflowSeries({
        payments: (payRes.data || []) as { created_at: string; amount: number }[],
        sales: cashSalesRows.map((s) => ({ created_at: s.created_at, paid: Number(s.paid) - (s.customer_id ? 0 : Number(s.refunded_amount || 0)) })),
        supplierPayments: (supPayRes.data || []) as { created_at: string; amount: number }[],
        expenses: (expRes.data || []) as { expense_date: string; amount: number }[],
        from: new Date(`${from}T00:00:00`),
        to: new Date(`${to}T23:59:59.999`),
        lang,
      });
    }

    setData(result);
    setLoading(false);
  };

  const tabs: { key: ReportTab; label: string; icon: React.ReactNode }[] = useMemo(() => {
    const all: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
      { key: 'sales', label: t('salesReport'), icon: <ShoppingBag size={16} /> },
      { key: 'purchases', label: t('purchasesReport'), icon: <Package size={16} /> },
      { key: 'inventory', label: t('inventoryReport'), icon: <Boxes size={16} /> },
      { key: 'profit', label: t('profitReport'), icon: <TrendingUp size={16} /> },
      { key: 'categories', label: t('categoryPerformance'), icon: <PieChart size={16} /> },
      { key: 'customers', label: t('customersReport'), icon: <Users size={16} /> },
      { key: 'suppliers', label: t('suppliersReport'), icon: <Truck size={16} /> },
      { key: 'debts', label: t('debtsReport'), icon: <Wallet size={16} /> },
      { key: 'top', label: t('topProductsReport'), icon: <BarChart3 size={16} /> },
      { key: 'cashflow', label: t('cashFlowReport'), icon: <ArrowUp size={16} /> },
      { key: 'expenses', label: t('expensesReport'), icon: <Wallet size={16} /> },
      { key: 'yearly', label: t('yearlyReport'), icon: <TrendingUp size={16} /> },
    ];
    return canFinance() ? all : all.filter((tb) => !FINANCIAL_TABS.includes(tb.key));
  }, [t, canFinance]);

  const catSortAccessors: Record<string, (r: CategoryPerf) => string | number> = useMemo(() => ({
    name: (r) => (lang === 'ar' && r.name_ar ? r.name_ar : r.name),
    products: (r) => r.products,
    purchases: (r) => r.purchases_amount,
    unitsPurchased: (r) => r.units_purchased,
    revenue: (r) => r.sales_revenue,
    unitsSold: (r) => r.units_sold,
    cogs: (r) => r.cogs,
    profit: (r) => r.gross_profit,
    margin: (r) => r.margin,
  }), [lang]);

  const sortedCategories = useMemo(() => {
    const rows = (data.categories as CategoryPerf[] | undefined) || [];
    const acc = catSortAccessors[catSort.key];
    if (!acc) return rows;
    const m = catSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => { const av = acc(a), bv = acc(b); return (av > bv ? 1 : av < bv ? -1 : 0) * m; });
  }, [data.categories, catSort, catSortAccessors]);

  const toggleCatSort = useCallback((k: string) => {
    setCatSort((prev) => prev.key === k ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' });
  }, []);

  const CatTh = ({ label, k, className }: { label: string; k: string; className?: string }) => (
    <th className={`table-header ${className || ''}`}>
      <button className="inline-flex items-center gap-1 hover:text-accent transition-colors" onClick={() => toggleCatSort(k)}>
        {label}
        {catSort.key === k && (catSort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );

  const exportCSV = () => {
    let rows: (string | number)[][] = [];
    const filename = `report-${tab}.csv`;
    const money = (v: unknown) => Number(v) || 0;
    switch (tab) {
      case 'sales':
        rows = [['Invoice', 'Customer', 'Date', 'Method', 'Total'], ...((data.sales as Sale[]) || []).map((s) => [s.invoice_number, s.customer?.name || '-', formatDate(s.created_at!, lang), s.payment_method, money(s.total)])];
        break;
      case 'purchases':
        rows = [['Invoice', 'Supplier', 'Date', 'Total'], ...((data.purchases as Purchase[]) || []).map((p) => [p.invoice_number || '-', p.supplier?.name || '-', formatDate(p.created_at!, lang), money(p.total)])];
        break;
      case 'inventory':
        rows = [['Product', 'Stock', 'Category', 'Selling Price'], ...((data.products as Product[]) || []).map((p) => [p.name, p.current_stock, p.category?.name || '-', p.selling_price_unit])];
        break;
      case 'profit':
        rows = [['Gross Sales', 'Discounts', 'Net Sales', 'COGS', 'Gross Profit', 'Expenses', 'Net Profit'], [money(data.grossSales), money(data.discounts), money(data.revenue), money(data.cost), money(data.grossProfit), money(data.expenses), money(data.netProfit)]];
        break;
      case 'categories':
        rows = [['Category', 'Products', 'Purchases', 'Units Purchased', 'Revenue', 'Units Sold', 'COGS', 'Gross Profit', 'Margin %'], ...sortedCategories.map((r) => [r.name, r.products, money(r.purchases_amount), r.units_purchased, money(r.sales_revenue), r.units_sold, money(r.cogs), money(r.gross_profit), `${r.margin.toFixed(1)}%`])];
        break;
      case 'customers':
        rows = [['Name', 'Phone', 'Balance'], ...((data.customers as Customer[]) || []).map((c) => [c.name, c.phone || '-', money(c.balance)])];
        break;
      case 'suppliers':
        rows = [['Name', 'Phone', 'Balance'], ...((data.suppliers as Supplier[]) || []).map((s) => [s.name, s.phone || '-', money((data.supplierAccounts as Record<string, { remaining: number }> | undefined)?.[s.id]?.remaining)])];
        break;
      case 'debts':
        rows = [['Customer', 'Phone', 'Balance'], ...((data.debts as Customer[]) || []).map((c) => [c.name, c.phone || '-', money(c.balance)])];
        break;
      case 'top':
        rows = [['Rank', 'Product', 'Qty', 'Revenue'], ...((data.top as [string, { qty: number; revenue: number }][]) || []).map(([name, v], i) => [i + 1, name, v.qty, v.revenue])];
        break;
      case 'cashflow': {
        const cf = data.cashflow as CashflowTotals | undefined;
        rows = [['Cash In', 'Cash Out', 'Net Cashflow', 'Customer Payments', 'Cash Sales', 'Supplier Payments', 'Expenses'], [money(cf?.cashIn), money(cf?.cashOut), money(cf?.netCashflow), money(cf?.customerPayments), money(cf?.salesCollected), money(cf?.supplierPayments), money(cf?.expenses)]];
        break;
      }
      case 'expenses':
        rows = [['Category', 'Count', 'Amount'], ...(((data.expenseStats as ExpenseStats | undefined)?.byCategory) || []).map((c) => [c.label, c.count, c.amount])];
        break;
      case 'yearly':
        rows = [['Month', 'Sales', 'Discounts', 'COGS', 'Gross', 'Expenses', 'Net'], ...(((data.yearly as YearlyReport | undefined)?.months) || []).map((m) => [m.label, m.revenue, m.discounts, m.cogs, m.gross, m.expenses, m.net])];
        break;
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <FullPageSpinner />;

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <PageHeader title={t('reports')}
        actions={<button className="btn-secondary" onClick={exportCSV}><Download size={18} /> {t('exportCsv')}</button>} />

      <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {((['today', 'week', 'month', 'year', 'custom']) as ReportPeriod[]).map((p) => (
            <button key={p} className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all ${period === p ? 'bg-accent text-white shadow-soft' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`} onClick={() => applyPeriod(p)}>
              {p === 'today' ? t('today') : p === 'week' ? t('thisWeek') : p === 'month' ? t('thisMonth') : p === 'year' ? t('thisYear') : t('customPeriod')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ms-auto">
          <label className="label mb-0">{t('fromDate')}</label>
          <input type="date" className="input py-2" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod('custom'); }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="label mb-0">{t('toDate')}</label>
          <input type="date" className="input py-2" value={to} onChange={(e) => { setTo(e.target.value); setPeriod('custom'); }} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {tabs.map((tb) => (
          <button key={tb.key} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${tab === tb.key ? 'bg-accent text-white shadow-soft' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`} onClick={() => setTab(tb.key)}>
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      <div className="card p-5">
        {tab === 'sales' && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20"><p className="text-xs text-gray-500">{t('netSales')} Â· {t('today')}</p><p className="text-xl font-bold tabular-nums">{formatMoney(Number(data.todayTotal), cur)}</p></div>
              <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20"><p className="text-xs text-gray-500">{t('netSales')} Â· {t('periodTotal')}</p><p className="text-xl font-bold tabular-nums">{formatMoney(Number(data.rangeTotal), cur)}</p></div>
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('discounts')} Â· {t('today')}</p><p className="text-xl font-bold tabular-nums text-error">âˆ’ {formatMoney(Number(data.todayDiscounts), cur)}</p></div>
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('discounts')} Â· {t('periodTotal')}</p><p className="text-xl font-bold tabular-nums text-error">âˆ’ {formatMoney(Number(data.rangeDiscounts), cur)}</p></div>
              {canFinance() && (
                <>
                  <div className="p-4 rounded-xl bg-success-50 dark:bg-success-900/20"><p className="text-xs text-gray-500">{t('cashCollected')} Â· {t('today')}</p><p className="text-xl font-bold tabular-nums">{formatMoney(Number(data.todayCash), cur)}</p></div>
                  <div className="p-4 rounded-xl bg-success-50 dark:bg-success-900/20"><p className="text-xs text-gray-500">{t('cashCollected')} Â· {t('periodTotal')}</p><p className="text-xl font-bold tabular-nums">{formatMoney(Number(data.rangeCash), cur)}</p></div>
                </>
              )}
            </div>
            <SaleTable sales={(data.sales as Sale[]) || []} cur={cur} lang={lang} t={t} onView={openReceipt} />
          </div>
        )}
        {tab === 'purchases' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('invoiceNumber')}</th><th className="table-header">{t('supplier')}</th><th className="table-header hidden md:table-cell">{t('dateCol')}</th><th className="table-header">{t('total')}</th></tr></thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {((data.purchases as Purchase[]) || []).map((p) => (
                  <tr key={p.id}><td className="table-cell font-medium">{p.invoice_number}</td><td className="table-cell">{p.supplier?.name || '-'}</td><td className="table-cell hidden md:table-cell">{formatDate(p.created_at!, lang)}</td><td className="table-cell font-bold tabular-nums">{formatMoney(p.total, cur)}</td></tr>
                ))}
              </tbody>
            </table>
            {((data.purchases as Purchase[]) || []).length === 0 && <EmptyState title={t('noData')} />}
          </div>
        )}
        {tab === 'inventory' && (
          <div>
            <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20 mb-4"><p className="text-xs text-gray-500">{t('inventoryValue')}</p><p className="text-2xl font-bold tabular-nums">{formatMoney(Number(data.totalValue), cur)}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('product')}</th><th className="table-header">{t('stock')}</th><th className="table-header hidden md:table-cell">{t('category')}</th><th className="table-header">{t('sellingPrice')}</th></tr></thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {((data.products as Product[]) || []).map((p) => (
                    <tr key={p.id}><td className="table-cell font-medium">{p.name}</td><td className="table-cell tabular-nums">{p.current_stock}</td><td className="table-cell hidden md:table-cell">{p.category?.name || '-'}</td><td className="table-cell tabular-nums">{formatMoney(p.selling_price_unit, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'profit' && (
          <div className="max-w-2xl space-y-3">
            <div className="p-5 rounded-xl bg-accent-50 dark:bg-accent-900/20 flex items-center justify-between">
              <span className="font-semibold">{t('grossSales')}</span>
              <span className="text-2xl font-bold tabular-nums">{formatMoney(Number(data.grossSales), cur)}</span>
            </div>
            <div className="flex items-center justify-between px-5">
              <span className="text-gray-500">{t('discounts')}</span>
              <span className="font-semibold tabular-nums text-error">âˆ’ {formatMoney(Number(data.discounts), cur)}</span>
            </div>
            <div className="border-t border-dashed border-gray-200 dark:border-gray-700 pt-3 px-5 flex items-center justify-between">
              <span className="font-semibold">{t('netSales')}</span>
              <span className="text-lg font-bold tabular-nums">{formatMoney(Number(data.revenue), cur)}</span>
            </div>
            <div className="flex items-center justify-between px-5">
              <span className="text-gray-500">{t('cogs')}</span>
              <span className="font-semibold tabular-nums text-error">âˆ’ {formatMoney(Number(data.cost), cur)}</span>
            </div>
            <div className="border-t border-dashed border-gray-200 dark:border-gray-700 pt-3 px-5 flex items-center justify-between">
              <span className="font-semibold">{t('grossProfit')}</span>
              <span className={`text-lg font-bold tabular-nums ${Number(data.grossProfit) >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(Number(data.grossProfit), cur)}</span>
            </div>
            <div className="flex items-center justify-between px-5">
              <span className="text-gray-500">{t('operatingExpenses')}</span>
              <span className="font-semibold tabular-nums text-error">âˆ’ {formatMoney(Number(data.expenses), cur)}</span>
            </div>
            <div className="p-5 rounded-xl bg-success-50 dark:bg-success-900/20 flex items-center justify-between">
              <span className="font-semibold">{t('netProfit')}</span>
              <span className={`text-2xl font-bold tabular-nums ${Number(data.netProfit) >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(Number(data.netProfit), cur)}</span>
            </div>
            <p className="text-xs text-gray-400 px-5">{t('cogsNote')}</p>
          </div>
        )}
        {tab === 'expenses' && (
          <ExpenseReportView stats={data.expenseStats as ExpenseStats | undefined} period={period} legacy={!!data.expenseLegacy} cur={cur} t={t} />
        )}
        {tab === 'yearly' && (
          <YearlyReportView yearly={data.yearly as YearlyReport | undefined} year={year} onYear={setYear} cur={cur} t={t} />
        )}
        {tab === 'categories' && (
          <div>
            <p className="text-xs text-gray-500 mb-4">{t('cogsNote')}</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <CatTh label={t('category')} k="name" />
                    <CatTh label={t('productsCount')} k="products" className="text-end" />
                    <CatTh label={t('purchasesAmount')} k="purchases" className="text-end" />
                    <CatTh label={t('unitsPurchased')} k="unitsPurchased" className="text-end" />
                    <CatTh label={t('revenue')} k="revenue" className="text-end" />
                    <CatTh label={t('unitsSold')} k="unitsSold" className="text-end" />
                    <CatTh label={t('cogs')} k="cogs" className="text-end" />
                    <CatTh label={t('grossProfit')} k="profit" className="text-end" />
                    <CatTh label={t('profitMargin')} k="margin" className="text-end" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortedCategories.map((r) => (
                    <tr key={r.category_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="table-cell font-medium">{lang === 'ar' && r.name_ar ? r.name_ar : r.name}</td>
                      <td className="table-cell text-end tabular-nums">{r.products}</td>
                      <td className="table-cell text-end tabular-nums">{formatMoney(r.purchases_amount, cur)}</td>
                      <td className="table-cell text-end tabular-nums">{formatNumber(r.units_purchased)}</td>
                      <td className="table-cell text-end tabular-nums font-medium">{formatMoney(r.sales_revenue, cur)}</td>
                      <td className="table-cell text-end tabular-nums">{formatNumber(r.units_sold)}</td>
                      <td className="table-cell text-end tabular-nums">{formatMoney(r.cogs, cur)}</td>
                      <td className={`table-cell text-end tabular-nums font-bold ${r.gross_profit >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(r.gross_profit, cur)}</td>
                      <td className={`table-cell text-end tabular-nums font-bold ${r.margin >= 0 ? 'text-success' : 'text-error'}`}>{r.margin.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedCategories.length === 0 && <EmptyState title={t('noData')} />}
          </div>
        )}
        {tab === 'customers' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('name')}</th><th className="table-header">{t('phone')}</th><th className="table-header">{t('balance')}</th></tr></thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {((data.customers as Customer[]) || []).map((c) => (
                  <tr key={c.id}><td className="table-cell font-medium">{c.name}</td><td className="table-cell">{c.phone || '-'}</td><td className={`table-cell font-bold tabular-nums ${Number(c.balance) > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(c.balance, cur)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'suppliers' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('name')}</th><th className="table-header">{t('phone')}</th><th className="table-header">{t('balance')}</th></tr></thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {((data.suppliers as Supplier[]) || []).map((s) => {
                  const remaining = (data.supplierAccounts as Record<string, { remaining: number }> | undefined)?.[s.id]?.remaining ?? 0;
                  return (
                    <tr key={s.id}><td className="table-cell font-medium">{s.name}</td><td className="table-cell">{s.phone || '-'}</td><td className={`table-cell font-bold tabular-nums ${remaining > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(remaining, cur)}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'debts' && (
          <div>
            <div className="p-4 rounded-xl bg-error-50 dark:bg-error-900/20 mb-4"><p className="text-xs text-gray-500">{t('pendingDebts')}</p><p className="text-2xl font-bold text-error tabular-nums">{formatMoney(Number(data.totalDebt), cur)}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('customer')}</th><th className="table-header">{t('phone')}</th><th className="table-header">{t('balance')}</th></tr></thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {((data.debts as Customer[]) || []).map((c) => (
                    <tr key={c.id}><td className="table-cell font-medium">{c.name}</td><td className="table-cell">{c.phone || '-'}</td><td className="table-cell font-bold text-error tabular-nums">{formatMoney(c.balance, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'top' && (
          <div className="space-y-2">
            {((data.top as [string, { qty: number; revenue: number }][] || []).map(([name, v], i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                <span className="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center text-accent-700 dark:text-accent-300 font-bold text-sm">{i + 1}</span>
                <span className="flex-1 font-medium">{name}</span>
                <span className="text-sm text-gray-500 tabular-nums">{v.qty} {t('units')}</span>
                <span className="font-bold tabular-nums">{formatMoney(v.revenue, cur)}</span>
              </div>
            )))}
            {((data.top as unknown[]) || []).length === 0 && <EmptyState title={t('noData')} />}
          </div>
        )}
        {tab === 'cashflow' && (
          <CashflowView cashflow={data.cashflow as CashflowTotals | undefined} series={(data.cashflowSeries as CashflowPoint[]) || []} cur={cur} t={t} />
        )}
      </div>

      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={viewSale?.invoice_number || ''} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setViewSale(null)}>{t('close')}</button></>}>
        {viewSale && (
          <div className="font-mono text-xs space-y-1 p-4 bg-white dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="text-center">
              <p className="font-bold text-sm">{lang === 'ar' && settings?.store_name_ar ? settings.store_name_ar : (settings?.store_name || '')}</p>
              {settings?.address && <p>{settings.address}</p>}
              {settings?.phone && <p>{settings.phone}</p>}
            </div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <p>{t('invoice')}: {viewSale.invoice_number}</p>
            <p>{formatDateTime(viewSale.created_at!, lang)}</p>
            <p>{t('cashier')}: {viewSale.cashier?.username || '-'}</p>
            {viewSale.customer && <p>{t('customer')}: {viewSale.customer.name}</p>}
            <div className="border-t border-dashed border-gray-300 my-2" />
            {viewItems.map((it, i) => (
              <div key={i} className="flex justify-between"><span>{it.qty}Ã— {it.name}{it.sell_as === 'box' ? ` (${t('box')})` : ''}</span><span>{formatMoney(it.subtotal, cur)}</span></div>
            ))}
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="flex justify-between"><span>{t('subtotal')}</span><span>{formatMoney(Number(viewSale.subtotal) || 0, cur)}</span></div>
            {Number(viewSale.discount) > 0 && <div className="flex justify-between"><span>{t('discount')}</span><span>{formatMoney(Number(viewSale.discount) || 0, cur)}</span></div>}
            {Number(viewSale.tax) > 0 && <div className="flex justify-between"><span>{t('tax')}</span><span>{formatMoney(Number(viewSale.tax) || 0, cur)}</span></div>}
            <div className="flex justify-between font-bold"><span>{t('grandTotal')}</span><span>{formatMoney(Number(viewSale.total) || 0, cur)}</span></div>
            <div className="flex justify-between"><span>{t('paid')}</span><span>{formatMoney(Number(viewSale.paid) || 0, cur)}</span></div>
            {Number(viewSale.remaining) > 0 && <div className="flex justify-between"><span>{t('remaining')}</span><span>{formatMoney(Number(viewSale.remaining) || 0, cur)}</span></div>}
            <div className="border-t border-dashed border-gray-300 my-2" />
            <p className="text-center">{settings?.footer_message || t('thankYouFooter')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

const SaleTable = memo(function SaleTable({ sales, cur, lang, t, onView }: { sales: Sale[]; cur: string; lang: Lang; t: (key: TranslationKey) => string; onView: (s: Sale) => void }) {
  if (sales.length === 0) return <EmptyState title={t('noData')} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-800/50"><tr><th className="table-header">{t('invoiceNumber')}</th><th className="table-header">{t('customer')}</th><th className="table-header hidden md:table-cell">{t('dateCol')}</th><th className="table-header">{t('method')}</th><th className="table-header">{t('total')}</th><th className="table-header"></th></tr></thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
          {sales.map((s) => (
            <tr key={s.id}><td className="table-cell font-medium">{s.invoice_number}</td><td className="table-cell">{s.customer?.name || '-'}</td><td className="table-cell hidden md:table-cell">{formatDate(s.created_at!, lang)}</td><td className="table-cell">{s.payment_method}</td><td className="table-cell font-bold tabular-nums">{formatMoney(Number(s.total) - Number(s.refunded_amount || 0), cur)}</td><td className="table-cell">
              <button className="btn-ghost p-1.5 rounded-lg text-gray-400 hover:text-accent" onClick={() => onView(s)} title={t('view')}><Eye size={16} /></button>
            </td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const CHART_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const ExpenseReportView = memo(function ExpenseReportView({ stats, period, legacy, cur, t }: {
  stats?: ExpenseStats;
  period: ReportPeriod;
  legacy: boolean;
  cur: string;
  t: (key: TranslationKey) => string;
}) {
  const total = stats?.total ?? 0;
  const donutData = (stats?.byCategory ?? []).slice(0, 8).map((c, i) => ({ label: c.label, value: c.amount, color: CHART_COLORS[i % CHART_COLORS.length] }));
  const breakdownChart = (stats?.breakdown ?? []).map((b) => ({ label: b.label, value: b.amount }));
  const fmtChart = (v: number) => formatMoney(v, cur);
  const maxTop = Math.max(...(stats?.topCategories ?? []).map((c) => c.amount), 1);

  return (
    <div className="space-y-5">
      {legacy && (
        <div className="p-4 rounded-xl bg-warning/10 border border-warning/20 text-warning flex items-center gap-2 text-sm">
          <AlertTriangle size={16} className="shrink-0" /> {t('expensesNeedsMigration')}
        </div>
      )}

      {stats && stats.count > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-error-50 dark:bg-error-900/20">
              <p className="text-xs text-gray-500">{t('totalExpenses')}</p>
              <p className="text-2xl font-bold tabular-nums text-error">{formatMoney(total, cur)}</p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-500">{t('numberOfExpenses')}</p>
              <p className="text-2xl font-bold tabular-nums">{formatNumber(stats.count)}</p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-500">{t('topCategories')}</p>
              <p className="text-lg font-bold truncate">{stats.topCategories[0]?.label || '-'}</p>
              <p className="text-xs text-gray-400 tabular-nums">{stats.topCategories[0] ? formatMoney(stats.topCategories[0].amount, cur) : ''}</p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-500">{t('period')}</p>
              <p className="text-lg font-bold">{period === 'today' ? t('today') : period === 'week' ? t('thisWeek') : period === 'month' ? t('thisMonth') : period === 'year' ? t('thisYear') : t('customPeriod')}</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">
              {stats.granularity === 'day' ? t('dailyBreakdown') : stats.granularity === 'week' ? t('weeklyBreakdown') : t('monthlyBreakdown')}
            </h4>
            {breakdownChart.length > 0 && <BarChart data={breakdownChart} format={fmtChart} color="#EF4444" height={200} />}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
              <h4 className="font-semibold text-sm mb-3">{t('byCategory')}</h4>
              {donutData.length > 0 ? <DonutChart data={donutData} size={170} /> : <EmptyState title={t('noData')} />}
            </div>
            <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="table-header">{t('expenseCategory')}</th>
                    <th className="table-header text-end">{t('count')}</th>
                    <th className="table-header text-end">{t('expenseAmount')}</th>
                    <th className="table-header text-end">{t('share')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {stats.byCategory.map((c) => (
                    <tr key={c.category} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="table-cell font-medium">{c.label}</td>
                      <td className="table-cell text-end tabular-nums">{formatNumber(c.count)}</td>
                      <td className="table-cell text-end font-bold tabular-nums">{formatMoney(c.amount, cur)}</td>
                      <td className="table-cell text-end tabular-nums text-gray-500">{total > 0 ? ((c.amount / total) * 100).toFixed(1) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.byCategory.length === 0 && <EmptyState title={t('noData')} />}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('byPaymentMethod')}</th>
                  <th className="table-header text-end">{t('count')}</th>
                  <th className="table-header text-end">{t('expenseAmount')}</th>
                  <th className="table-header text-end">{t('share')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {stats.byMethod.map((m) => (
                  <tr key={m.method} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="table-cell font-medium">{m.label}</td>
                    <td className="table-cell text-end tabular-nums">{formatNumber(m.count)}</td>
                    <td className="table-cell text-end font-bold tabular-nums">{formatMoney(m.amount, cur)}</td>
                    <td className="table-cell text-end tabular-nums text-gray-500">{total > 0 ? ((m.amount / total) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('byPaymentSource')}</th>
                  <th className="table-header text-end">{t('count')}</th>
                  <th className="table-header text-end">{t('expenseAmount')}</th>
                  <th className="table-header text-end">{t('share')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {stats.bySource.map((s) => (
                  <tr key={s.source} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="table-cell font-medium">{s.label}</td>
                    <td className="table-cell text-end tabular-nums">{formatNumber(s.count)}</td>
                    <td className="table-cell text-end font-bold tabular-nums">{formatMoney(s.amount, cur)}</td>
                    <td className="table-cell text-end tabular-nums text-gray-500">{total > 0 ? ((s.amount / total) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">{t('topCategories')}</h4>
            {stats.topCategories.length > 0 ? (
              <div className="space-y-2">
                {stats.topCategories.map((c) => (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm font-medium truncate">{c.label}</span>
                    <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full bg-error transition-all duration-500" style={{ width: `${(c.amount / maxTop) * 100}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-end text-sm font-bold tabular-nums">{formatMoney(c.amount, cur)}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyState title={t('noData')} />}
          </div>
        </>
      ) : (
        !legacy && <EmptyState title={t('noData')} subtitle={t('noResults')} />
      )}
    </div>
  );
});

const YearlyReportView = memo(function YearlyReportView({ yearly, year, onYear, cur, t }: {
  yearly?: YearlyReport;
  year: number;
  onYear: (y: number) => void;
  cur: string;
  t: (key: TranslationKey) => string;
}) {
  const months = yearly?.months ?? [];
  const salesChart = months.map((m) => ({ label: m.label, value: m.revenue }));
  const expenseChart = months.map((m) => ({ label: m.label, value: m.expenses }));
  const fmtChart = (v: number) => formatMoney(v, cur);
  const net = yearly?.netProfit ?? 0;
  const gross = yearly?.grossProfit ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <label className="label mb-0">{t('year')}</label>
        <input type="number" min={2000} max={2100} className="input w-32 py-2 tabular-nums" value={year} onChange={(e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) onYear(v); }} />
      </div>

      {yearly?.legacy && (
        <div className="p-4 rounded-xl bg-warning/10 border border-warning/20 text-warning flex items-center gap-2 text-sm">
          <AlertTriangle size={16} className="shrink-0" /> {t('expensesNeedsMigration')}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20">
          <p className="text-xs text-gray-500">{t('totalSales')} ({t('netSales')})</p>
          <p className="text-xl font-bold tabular-nums">{formatMoney(yearly?.totalSales ?? 0, cur)}</p>
          {(yearly?.discounts ?? 0) > 0 && <p className="text-xs text-error tabular-nums mt-1">{t('discounts')}: âˆ’ {formatMoney(yearly?.discounts ?? 0, cur)}</p>}
        </div>
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
          <p className="text-xs text-gray-500">{t('cogs')}</p>
          <p className="text-xl font-bold tabular-nums">{formatMoney(yearly?.totalCogs ?? 0, cur)}</p>
        </div>
        <div className="p-4 rounded-xl bg-secondary-100 dark:bg-secondary-900/30">
          <p className="text-xs text-gray-500">{t('grossProfit')}</p>
          <p className={`text-xl font-bold tabular-nums ${gross >= 0 ? 'text-secondary-700 dark:text-secondary-300' : 'text-error'}`}>{formatMoney(gross, cur)}</p>
        </div>
        <div className="p-4 rounded-xl bg-error-50 dark:bg-error-900/20">
          <p className="text-xs text-gray-500">{t('totalExpenses')}</p>
          <p className="text-xl font-bold tabular-nums text-error">{formatMoney(yearly?.totalExpenses ?? 0, cur)}</p>
        </div>
        <div className={`p-4 rounded-xl ${net >= 0 ? 'bg-success-50 dark:bg-success-900/20' : 'bg-error-50 dark:bg-error-900/20'}`}>
          <p className="text-xs text-gray-500">{t('netProfit')}</p>
          <p className={`text-xl font-bold tabular-nums ${net >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(net, cur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
          <h4 className="font-semibold text-sm mb-3">{t('totalSales')}</h4>
          <BarChart data={salesChart} format={fmtChart} color="#2563EB" height={180} />
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
          <h4 className="font-semibold text-sm mb-3">{t('expenses')}</h4>
          <BarChart data={expenseChart} format={fmtChart} color="#EF4444" height={180} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="table-header">{t('monthlyBreakdown')}</th>
                <th className="table-header text-end">{t('totalSales')}</th>
                <th className="table-header text-end">{t('discounts')}</th>
                <th className="table-header text-end">{t('cogs')}</th>
                <th className="table-header text-end">{t('grossProfit')}</th>
                <th className="table-header text-end">{t('expenses')}</th>
                <th className="table-header text-end">{t('netProfit')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {months.map((m) => (
                <tr key={m.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="table-cell font-medium">{m.label}</td>
                  <td className="table-cell text-end tabular-nums">{formatMoney(m.revenue, cur)}</td>
                  <td className="table-cell text-end tabular-nums text-error">{m.discounts > 0 ? `âˆ’ ${formatMoney(m.discounts, cur)}` : 'âˆ’'}</td>
                  <td className="table-cell text-end tabular-nums">{formatMoney(m.cogs, cur)}</td>
                  <td className={`table-cell text-end tabular-nums ${m.gross >= 0 ? '' : 'text-error'}`}>{formatMoney(m.gross, cur)}</td>
                  <td className="table-cell text-end tabular-nums text-error">{formatMoney(m.expenses, cur)}</td>
                  <td className={`table-cell text-end font-bold tabular-nums ${m.net >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(m.net, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {months.length === 0 && <EmptyState title={t('noData')} />}
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-3">{t('expensesByCategory')}</h4>
        {yearly && yearly.byCategory.length > 0 ? (
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('expenseCategory')}</th>
                  <th className="table-header text-end">{t('count')}</th>
                  <th className="table-header text-end">{t('expenseAmount')}</th>
                  <th className="table-header text-end">{t('share')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {yearly.byCategory.map((c) => (
                  <tr key={c.category} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="table-cell font-medium">{c.label}</td>
                    <td className="table-cell text-end tabular-nums">{formatNumber(c.count)}</td>
                    <td className="table-cell text-end font-bold tabular-nums">{formatMoney(c.amount, cur)}</td>
                    <td className="table-cell text-end tabular-nums text-gray-500">{yearly.totalExpenses > 0 ? ((c.amount / yearly.totalExpenses) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title={t('noData')} />}
      </div>
    </div>
  );
});

const CashflowView = memo(function CashflowView({ cashflow, series, cur, t }: {
  cashflow?: CashflowTotals;
  series: CashflowPoint[];
  cur: string;
  t: (key: TranslationKey) => string;
}) {
  const cf = cashflow ?? {
    cashIn: 0, cashOut: 0, netCashflow: 0, customerPayments: 0, salesCollected: 0, supplierPayments: 0, expenses: 0,
  };
  const maxAbs = Math.max(...series.map((p) => Math.max(Math.abs(p.cashIn), Math.abs(p.cashOut))), 1);
  const fmtChart = (v: number) => formatMoney(v, cur);

  const Bar = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400 truncate pe-2">{label}</span>
        <span className="font-semibold tabular-nums">{formatMoney(value, cur)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (Math.abs(value) / maxAbs) * 100)}%`, background: color }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-success-50 dark:bg-success-900/20">
          <p className="text-xs text-gray-500">{t('cashIn')}</p>
          <p className="text-2xl font-bold text-success tabular-nums">{formatMoney(cf.cashIn, cur)}</p>
        </div>
        <div className="p-4 rounded-xl bg-error-50 dark:bg-error-900/20">
          <p className="text-xs text-gray-500">{t('cashOut')}</p>
          <p className="text-2xl font-bold text-error tabular-nums">{formatMoney(cf.cashOut, cur)}</p>
        </div>
        <div className={`p-4 rounded-xl ${cf.netCashflow >= 0 ? 'bg-accent-50 dark:bg-accent-900/20' : 'bg-error-50 dark:bg-error-900/20'}`}>
          <p className="text-xs text-gray-500">{t('netCashflow')}</p>
          <p className={`text-2xl font-bold tabular-nums ${cf.netCashflow >= 0 ? 'text-accent' : 'text-error'}`}>{formatMoney(cf.netCashflow, cur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3">
          <h4 className="font-semibold text-sm">{t('cashIn')}</h4>
          <Bar label={t('fromCustomerPayments')} value={cf.customerPayments} color="#10B981" />
          <Bar label={t('fromSalesCollected')} value={cf.salesCollected} color="#2563EB" />
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3">
          <h4 className="font-semibold text-sm">{t('cashOut')}</h4>
          <Bar label={t('toSupplierPayments')} value={cf.supplierPayments} color="#F59E0B" />
          <Bar label={t('toOperatingExpenses')} value={cf.expenses} color="#EF4444" />
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-3">{t('netCashflow')} Â· {t('monthlyBreakdown')}</h4>
        {series.length > 0 ? (
          <div className="space-y-4">
            {series.map((p) => (
              <div key={p.key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium truncate">{p.label}</span>
                <div className="flex-1 flex items-center gap-1">
                  <div className="flex-1 h-4 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex justify-end">
                    {p.cashIn > 0 && <div className="h-full rounded-l-full bg-success transition-all duration-500" style={{ width: `${(p.cashIn / maxAbs) * 50}%` }} />}
                  </div>
                  <div className="flex-1 h-4 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    {p.cashOut > 0 && <div className="h-full rounded-r-full bg-error transition-all duration-500" style={{ width: `${(p.cashOut / maxAbs) * 50}%` }} />}
                  </div>
                </div>
                <span className={`w-28 shrink-0 text-end text-sm font-bold tabular-nums ${p.net >= 0 ? 'text-success' : 'text-error'}`}>{fmtChart(p.net)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title={t('noData')} subtitle={t('noResults')} />}
      </div>
    </div>
  );
});
