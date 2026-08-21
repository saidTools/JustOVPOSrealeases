import { useEffect, useState, useCallback, useMemo, useDeferredValue } from 'react';
import { Search, Wallet, Printer, FileText, Phone, MapPin, Truck, Banknote, Check, User, StickyNote } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { apiFetch, ApiError } from '@/lib/api';
import { getLedgerCapability } from '@/lib/schema';
import { formatMoney, formatDate, formatDateTime, matchesSupplier } from '@/lib/utils';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import { computeSupplierAccounts } from '@/lib/supplierAccount';
import type { Supplier, Purchase, SupplierPayment } from '@/types';
import type { PaymentSource } from '@/types';

interface LedgerEntry {
  id: string;
  type: 'purchase' | 'payment';
  date: string;
  amount: number;
  invoice: string | null;
  notes: string | null;
  user: string | null;
  source?: string | null;
}

export default function SupplierLedger() {
  const { t, lang, settings } = useApp();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [paySource, setPaySource] = useState<PaymentSource>('cash_register');
  const [payNotes, setPayNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showReceipt, setShowReceipt] = useState<SupplierPayment | null>(null);
  const [ledgerReady, setLedgerReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const cap = await getLedgerCapability();
    setLedgerReady(cap === 'full');
    const purSelect = cap === 'full'
      ? 'id, invoice_number, supplier_id, total, paid, remaining, notes, user_id, created_at'
      : 'id, invoice_number, supplier_id, total, notes, created_at';
    const [supRes, userRes, purRes, payRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('users').select('id, username'),
      supabase.from('purchases').select(purSelect).order('created_at', { ascending: true }),
      cap === 'full'
        ? supabase.from('supplier_payments').select('*, purchase:purchases(id, invoice_number)').order('created_at', { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);
    setSuppliers((supRes.data || []) as Supplier[]);
    setPurchases((purRes.data || []) as unknown as Purchase[]);
    setPayments((payRes.data || []) as SupplierPayment[]);
    const uMap: Record<string, string> = {};
    (userRes.data || []).forEach((u: { id: string; username: string }) => { uMap[u.id] = u.username; });
    setUsers(uMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cur = settings?.currency || 'DA';
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => suppliers.filter((s) => matchesSupplier(s, deferredSearch)), [suppliers, deferredSearch]);

  const accts = useMemo(() => computeSupplierAccounts(purchases), [purchases]);
  const selectedAcct = selected ? accts[selected.id] : null;
  const selectedBalance = selected ? (ledgerReady ? (selectedAcct?.remaining ?? 0) : (Number(selected.balance) || 0)) : 0;
  const selectedPayments = useMemo(() => (selected ? payments.filter((p) => p.supplier_id === selected.id) : []), [payments, selected]);

  const openDetail = (s: Supplier) => {
    setSelected(s);
    setPaySource('cash_register');
    setPayAmount(ledgerReady ? Number(accts[s.id]?.remaining) || 0 : Number(s.balance) || 0);

    const ps = purchases.filter((x) => x.supplier_id === s.id);
    const psPay = payments.filter((x) => x.supplier_id === s.id);
    const list: LedgerEntry[] = [
      ...ps.map((x) => ({
        id: `p-${x.id}`, type: 'purchase' as const, date: x.created_at!, amount: Number(x.total),
        invoice: x.invoice_number, notes: x.notes, user: x.user_id ? users[x.user_id] ?? null : null,
      })),
      ...psPay.map((x) => ({
        id: `d-${x.id}`, type: 'payment' as const, date: x.created_at!, amount: Number(x.amount),
        invoice: x.purchase?.invoice_number ?? null, notes: x.notes, user: x.user_id ? users[x.user_id] ?? null : null,
        source: x.payment_source ?? null,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEntries(list);
  };

  const savePayment = async () => {
    if (!selected || payAmount <= 0) return;
    setSaving(true);
    setSaveError('');
    try {
      // One transactional call: the server allocates the payment across the
      // supplier's open invoices (oldest first), updates each invoice's
      // paid/remaining and records the ledger row atomically.
      const pay = await apiFetch<SupplierPayment & { supplier?: Supplier }>('/api/supplier-payments', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: selected.id,
          amount: Math.min(payAmount, selectedBalance),
          payment_source: paySource,
          notes: payNotes || null,
        }),
      });
      setShowReceipt(pay);
      setPayOpen(false);
      setPayNotes('');
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <FullPageSpinner />;

  const storeName = lang === 'ar' && settings?.store_name_ar ? settings.store_name_ar : (settings?.store_name || t('appName'));

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <PageHeader title={t('supplierLedger')} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Supplier list */}
        <div className="card p-4">
          <div className="relative mb-3">
            <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
            <input className="input ps-10" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {filtered.map((s) => {
              const remaining = ledgerReady ? (accts[s.id]?.remaining ?? 0) : (Number(s.balance) || 0);
              return (
                <button key={s.id} className={`w-full flex items-center justify-between p-2.5 rounded-xl text-start transition-colors ${selected?.id === s.id ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`} onClick={() => openDetail(s)}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center text-accent-700 dark:text-accent-300 shrink-0"><Truck size={15} /></span>
                    <div className="min-w-0"><p className="font-medium text-sm truncate">{s.name}</p><p className="text-xs text-gray-400 truncate">{s.phone}</p></div>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${remaining > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(remaining, cur)}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <EmptyState title={t('noResults')} />}
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">{selected.name}</h3>
                    {selected.phone && <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><Phone size={14} /> {selected.phone}</p>}
                    {selected.address && <p className="text-sm text-gray-500 flex items-center gap-1"><MapPin size={14} /> {selected.address}</p>}
                  </div>
                  <div className="text-end">
                    <p className="text-xs text-gray-500">{t('currentBalance')}</p>
                    <p className={`text-2xl font-bold tabular-nums ${(ledgerReady ? selectedAcct?.remaining ?? 0 : Number(selected.balance) || 0) > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(ledgerReady ? selectedAcct?.remaining ?? 0 : Number(selected.balance) || 0, cur)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('invoices')}</p><p className="font-bold tabular-nums">{selectedAcct?.invoiceCount ?? 0}</p></div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('payments')}</p><p className="font-bold tabular-nums">{selectedPayments.length}</p></div>
                  {ledgerReady && <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('totalPaid')}</p><p className="font-bold text-sm tabular-nums text-success">{formatMoney(selectedAcct?.totalPaid ?? 0, cur)}</p></div>}
                  {ledgerReady && <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('totalPurchases')}</p><p className="font-bold text-sm tabular-nums">{formatMoney(selectedAcct?.totalPurchases ?? 0, cur)}</p></div>}
                </div>
                <div className="flex gap-2 mt-4">
                  <button className="btn-primary flex-1 text-sm" onClick={() => { setPayOpen(true); setPayAmount(ledgerReady ? selectedAcct?.remaining ?? 0 : Number(selected.balance) || 0); }}><Wallet size={16} /> {t('recordPayment')}</button>
                  <button className="btn-secondary flex-1 text-sm" onClick={() => window.print()}><Printer size={16} /> {t('supplierStatement')}</button>
                </div>
              </div>

              <div className="card p-5">
                <h4 className="font-semibold text-sm mb-3">{t('paymentHistory')}</h4>
                {entries.length > 0 ? (
                  <div className="space-y-1">
                    {entries.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${e.type === 'purchase' ? 'bg-error-100 text-error-600 dark:bg-error-900/30 dark:text-error-400' : 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400'}`}>
                          {e.type === 'purchase' ? <FileText size={15} /> : <Wallet size={15} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{e.type === 'purchase' ? (e.invoice ? `${t('purchaseInvoice')} ${e.invoice}` : t('purchaseInvoice')) : t('paidAmount')}</p>
                            {e.type === 'payment' && e.source && (
                              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.source === 'cash_register' ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300'}`}>
                                {e.source === 'cash_register' ? <Banknote size={10} /> : <User size={10} />}
                                {e.source === 'cash_register' ? t('paymentSourceRegister') : t('paymentSourcePersonal')}
                              </span>
                            )}
                            {e.notes && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"><StickyNote size={10} /> {e.notes}</span>}
                          </div>
                          <p className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                            <span>{formatDateTime(e.date, lang)}</span>
                            {e.user && <span className="inline-flex items-center gap-1"><User size={11} /> {e.user}</span>}
                          </p>
                        </div>
                        <span className={`font-bold tabular-nums shrink-0 ${e.type === 'purchase' ? 'text-error' : 'text-success'}`}>{e.type === 'purchase' ? '+' : '-'}{formatMoney(e.amount, cur)}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title={t('noData')} />}
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title={t('noSupplierSelected')} subtitle={t('search')} /></div>
          )}
        </div>
      </div>

      {/* Record payment */}
      <Modal open={payOpen} onClose={() => { if (!saving) setPayOpen(false); }} title={t('recordPayment')} size="md"
        footer={<><button className="btn-secondary" disabled={saving} onClick={() => setPayOpen(false)}>{t('cancel')}</button><button className="btn-primary" disabled={saving || payAmount <= 0 || payAmount > selectedBalance} onClick={savePayment}>{saving ? <Check size={18} /> : t('save')}</button></>}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="text-sm font-medium">{selected.name}</span>
              <span className="text-sm font-bold text-error tabular-nums">{t('currentBalance')}: {formatMoney(selectedBalance, cur)}</span>
            </div>
            <div>
              <label className="label">{t('paidAmount')}</label>
              <input type="number" step="0.01" className="input text-xl font-bold tabular-nums text-center" value={payAmount} onChange={(e) => setPayAmount(Math.max(0, Number(e.target.value)))} />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(selectedBalance)}>{t('payAll')}</button>
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(Math.floor(selectedBalance / 2))}>50%</button>
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(1000)}>1000</button>
              </div>
            </div>
            <div>
              <label className="label">{t('paymentSource')}</label>
              <div className="grid grid-cols-2 gap-2">
                {([['cash_register', <Banknote size={18} />, t('paymentSourceRegister')], ['personal', <User size={18} />, t('paymentSourcePersonal')]] as const).map(([s, icon, label]) => (
                  <button key={s} className={`p-3 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-medium transition-all ${paySource === s ? 'border-accent bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => setPaySource(s)}>{icon} {label}</button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">{paySource === 'cash_register' ? t('cashSupplierPayments') : t('paymentSourcePersonal')}</p>
            </div>
            <div>
              <label className="label">{t('notes')}</label>
              <textarea className="input min-h-[60px]" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
            <div className="p-3 rounded-xl bg-success-50 dark:bg-success-900/20 flex justify-between">
              <span className="text-sm">{t('remainingBalance')}</span>
              <span className="font-bold text-success tabular-nums">{formatMoney(Math.max(0, selectedBalance - payAmount), cur)}</span>
            </div>
            {saveError && <div className="px-4 py-3 rounded-xl bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 text-sm">{saveError}</div>}
          </div>
        )}
      </Modal>

      {/* Payment receipt */}
      <Modal open={!!showReceipt} onClose={() => setShowReceipt(null)} title={t('supplierPaymentReceipt')} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setShowReceipt(null)}>{t('close')}</button><button className="btn-primary" onClick={() => window.print()}><Printer size={18} /> {t('print')}</button></>}>
        {showReceipt && (
          <>
            <style>{`
              @page { margin: 0; size: 80mm auto; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              @media print {
                body * { visibility: hidden !important; }
                #receipt-print-area, #receipt-print-area * { visibility: visible !important; }
                #receipt-print-area {
                  position: fixed !important;
                  top: 0 !important;
                  left: 0 !important;
                  width: 80mm !important;
                  margin: 0 !important;
                  padding: 4mm !important;
                  box-shadow: none !important;
                  border: none !important;
                  border-radius: 0 !important;
                  background: #fff !important;
                  color: #000 !important;
                  font-size: 13px !important;
                  font-weight: 500;
                }
                #receipt-print-area, #receipt-print-area * { color: #000 !important; border-color: #000 !important; }
                #receipt-print-area .font-bold, #receipt-print-area .text-sm { font-weight: 700 !important; }
                .no-print { display: none !important; }
              }
            `}</style>
          <div id="receipt-print-area" className="font-mono text-xs space-y-1 p-4 bg-white dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="text-center"><p className="font-bold text-sm">{storeName}</p></div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <p>{t('date')}: {formatDate(showReceipt.created_at!, lang)}</p>
            <p>{t('supplier')}: {showReceipt.supplier?.name || '-'}</p>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="flex justify-between font-bold text-base"><span>{t('paidAmount')}</span><span>{formatMoney(showReceipt.amount, cur)}</span></div>
            <div className="flex justify-between"><span>{t('paymentSource')}</span><span>{(showReceipt.payment_source || 'cash_register') === 'cash_register' ? t('paymentSourceRegister') : t('paymentSourcePersonal')}</span></div>
            <p className="text-center mt-3">{settings?.footer_message || t('thankYouFooter')}</p>
          </div>
          </>
        )}
      </Modal>
    </div>
  );
}