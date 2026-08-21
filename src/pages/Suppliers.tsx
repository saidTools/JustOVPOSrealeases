import { useEffect, useState, useCallback, useMemo, useDeferredValue } from 'react';
import { Plus, Search, Truck, Phone, MapPin, Edit, Trash2, Wallet, FileText, Printer, Banknote, Check, StickyNote, User } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { apiFetch, ApiError } from '@/lib/api';
import { getLedgerCapability } from '@/lib/schema';
import { formatMoney, formatDate, formatDateTime, matchesSupplier } from '@/lib/utils';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import { computeSupplierAccounts, buildSupplierStatement } from '@/lib/supplierAccount';
import type { Supplier, Purchase, SupplierPayment } from '@/types';
import type { PaymentSource } from '@/types';

export default function Suppliers() {
  const { t, lang, settings, canModule } = useApp();
  const canCreate = canModule('suppliers', 'create');
  const canEdit = canModule('suppliers', 'edit');
  const canDelete = canModule('suppliers', 'delete');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [paySource, setPaySource] = useState<PaymentSource>('cash_register');
  const [payNotes, setPayNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showReceipt, setShowReceipt] = useState<(SupplierPayment & { supplier?: Supplier }) | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [ledgerReady, setLedgerReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const cap = await getLedgerCapability();
    setLedgerReady(cap === 'full');
    const purSelect = cap === 'full'
      ? 'id, invoice_number, supplier_id, total, paid, remaining, notes, user_id, created_at'
      : 'id, invoice_number, supplier_id, total, notes, created_at';
    const [supRes, purRes, payRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('purchases').select(purSelect).order('created_at', { ascending: true }),
      cap === 'full'
        ? supabase.from('supplier_payments').select('id, supplier_id, purchase_id, amount, payment_method, payment_source, notes, user_id, created_at').order('created_at', { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);
    setSuppliers((supRes.data || []) as Supplier[]);
    setPurchases((purRes.data || []) as unknown as Purchase[]);
    setPayments((payRes.data || []) as SupplierPayment[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => suppliers.filter((s) => matchesSupplier(s, deferredSearch)), [suppliers, deferredSearch]);
  const cur = settings?.currency || 'DA';

  const accts = useMemo(() => computeSupplierAccounts(purchases), [purchases]);

  const detailAcct = detail ? accts[detail.id] : null;
  const detailPurchases = useMemo(() => (detail ? purchases.filter((p) => p.supplier_id === detail.id) : []), [purchases, detail]);
  const detailPayments = useMemo(() => (detail ? payments.filter((p) => p.supplier_id === detail.id) : []), [payments, detail]);
  const statementRows = useMemo(() => (detail ? buildSupplierStatement(detailPurchases, detailPayments) : []), [detail, detailPurchases, detailPayments]);

  const openAdd = () => { setEditId(null); setForm({ name: '', phone: '', address: '', notes: '' }); setModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditId(s.id); setForm({ name: s.name, phone: s.phone || '', address: s.address || '', notes: s.notes || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editId) {
      await supabase.from('suppliers').update(form).eq('id', editId);
    } else {
      await supabase.from('suppliers').insert(form);
    }
    setModalOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('suppliers').delete().eq('id', id);
    load();
  };

  const openDetail = (s: Supplier) => {
    setDetail(s);
    setStatementOpen(false);
    setPayNotes('');
    setPayAmount(ledgerReady ? Number(accts[s.id]?.remaining) || 0 : Number(s.balance) || 0);
  };

  const openPay = () => {
    if (!detail) return;
    setPayAmount(ledgerReady ? Number(accts[detail.id]?.remaining) || 0 : Number(detail.balance) || 0);
    setPayNotes('');
    setPaySource('cash_register');
    setPayOpen(true);
  };

  const savePayment = async () => {
    if (!detail || payAmount <= 0) return;
    setSaving(true);
    setSaveError('');
    try {
      // One transactional call: the server allocates the payment across the
      // supplier's open invoices (oldest first), updates each invoice's
      // paid/remaining and records the ledger row atomically.
      const pay = await apiFetch<SupplierPayment & { supplier?: Supplier }>('/api/supplier-payments', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: detail.id,
          amount: Math.min(payAmount, detailRemaining(detail, detailAcct, ledgerReady)),
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
      <PageHeader title={t('suppliers')} subtitle={`${suppliers.length} ${t('totalItems')}`}
        actions={canCreate ? <button className="btn-primary" onClick={openAdd}><Plus size={18} /> {t('addSupplier')}</button> : undefined} />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
          <input className="input ps-10" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => {
            const acct = accts[s.id];
            const remaining = ledgerReady ? (acct?.remaining ?? 0) : (Number(s.balance) || 0);
            return (
              <div key={s.id} className="card p-5 hover:shadow-soft-lg transition-all cursor-pointer" onClick={() => openDetail(s)}>
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center text-accent-700 dark:text-accent-300"><Truck size={22} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{s.name}</p>
                    {s.phone && <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Phone size={12} /> {s.phone}</p>}
                  </div>
                  {(canEdit || canDelete) && (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {canEdit && <button className="btn-ghost p-1.5 rounded-lg" onClick={() => openEdit(s)}><Edit size={16} /></button>}
                      {canDelete && <button className="btn-ghost p-1.5 rounded-lg text-error" onClick={() => handleDelete(s.id)}><Trash2 size={16} /></button>}
                    </div>
                  )}
                </div>
                {s.address && <p className="text-xs text-gray-400 flex items-center gap-1 mt-3"><MapPin size={12} /> {s.address}</p>}
                <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-800 flex justify-between items-center">
                  <span className="text-xs text-gray-500">{ledgerReady ? t('remainingBalance') : t('balance')}</span>
                  <span className={`font-bold tabular-nums ${remaining > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(remaining, cur)}</span>
                </div>
                {ledgerReady && acct && acct.invoiceCount > 0 && (
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                    <span>{t('totalPurchases')}: <b className="tabular-nums text-gray-600 dark:text-gray-300">{formatMoney(acct.totalPurchases, cur)}</b></span>
                    <span>{t('totalPaid')}: <b className="tabular-nums text-gray-600 dark:text-gray-300">{formatMoney(acct.totalPaid, cur)}</b></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <div className="card"><EmptyState title={t('noResults')} action={canCreate ? <button className="btn-primary" onClick={openAdd}><Plus size={18} /> {t('addSupplier')}</button> : undefined} /></div>}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('edit') : t('addSupplier')}
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary" onClick={handleSave}>{t('save')}</button></>}>
        <div className="space-y-4">
          <div><label className="label">{t('name')} *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">{t('phone')}</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="label">{t('address')}</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><label className="label">{t('notes')}</label><textarea className="input min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('supplierDetails')} size="lg"
        footer={
          detail
            ? <div className="flex gap-2 w-full">
                {canCreate && <button className="btn-primary flex-1 text-sm" onClick={openPay}><Wallet size={16} /> {t('recordPayment')}</button>}
                <button className="btn-secondary flex-1 text-sm" onClick={() => setStatementOpen(true)}><Printer size={16} /> {t('supplierStatement')}</button>
              </div>
            : undefined
        }>
        {detail && (
          <div>
            {!ledgerReady && (
              <div className="p-3 mb-4 rounded-xl bg-warning/10 dark:bg-warning/10 text-warning text-sm flex items-center gap-2 border border-warning/20">
                <Wallet size={16} className="shrink-0" />
                <span>{t('supplierPaymentsNotice')}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('phone')}</p><p className="font-medium">{detail.phone || '-'}</p></div>
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('currentBalance')}</p><p className={`font-bold tabular-nums ${detailRemaining(detail, detailAcct, ledgerReady) > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(detailRemaining(detail, detailAcct, ledgerReady), cur)}</p></div>
            </div>
            {ledgerReady ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('totalPurchases')}</p><p className="font-bold tabular-nums">{formatMoney(detailAcct?.totalPurchases ?? 0, cur)}</p></div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('totalPaid')}</p><p className="font-bold tabular-nums text-success">{formatMoney(detailAcct?.totalPaid ?? 0, cur)}</p></div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('remainingBalance')}</p><p className={`font-bold tabular-nums ${(detailAcct?.remaining ?? 0) > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(detailAcct?.remaining ?? 0, cur)}</p></div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('invoices')}</p><p className="font-bold tabular-nums">{detailAcct?.invoiceCount ?? 0}</p></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('invoices')}</p><p className="font-bold tabular-nums">{detailPurchases.length}</p></div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-xs text-gray-500">{t('balance')}</p><p className={`font-bold tabular-nums ${Number(detail.balance) > 0 ? 'text-error' : 'text-success'}`}>{formatMoney(detail.balance, cur)}</p></div>
              </div>
            )}
            {detail.address && <p className="text-sm text-gray-500 mb-3 flex items-center gap-1"><MapPin size={14} /> {detail.address}</p>}

            <h4 className="font-semibold text-sm mb-2">{t('purchaseHistory')}</h4>
            {detailPurchases.length > 0 ? (
              <div className="space-y-1 mb-4">
                {detailPurchases.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{p.invoice_number || '-'}</p><p className="text-xs text-gray-400">{formatDate(p.created_at!, lang)}</p></div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-gray-500 tabular-nums">{t('total')}: {formatMoney(p.total, cur)}</span>
                      {ledgerReady && Number(p.remaining) > 0
                        ? <span className="text-warning font-semibold tabular-nums">{t('remainingBalance')}: {formatMoney(p.remaining, cur)}</span>
                        : ledgerReady && <span className="text-success font-semibold tabular-nums">{t('paid')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="mb-4"><EmptyState title={t('noData')} /></div>}

            {ledgerReady && (
              <>
                <h4 className="font-semibold text-sm mb-2">{t('paymentHistory')}</h4>
                {detailPayments.length > 0 ? (
                  <div className="space-y-1">
                {detailPayments.map((pay) => (
                  <div key={pay.id} className="flex items-center gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400 flex items-center justify-center shrink-0"><Wallet size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{formatMoney(pay.amount, cur)}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                        <span>{formatDateTime(pay.created_at!, lang)}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">{(pay.payment_source || 'cash_register') === 'cash_register' ? t('paymentSourceRegister') : t('paymentSourcePersonal')}</span>
                        {pay.notes && <span className="inline-flex items-center gap-1"><StickyNote size={10} /> {pay.notes}</span>}
                      </p>
                    </div>
                    <span className="text-success font-bold tabular-nums shrink-0">-{formatMoney(pay.amount, cur)}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyState title={t('noData')} />}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Record Payment Modal */}
      <Modal open={payOpen} onClose={() => { if (!saving) setPayOpen(false); }} title={t('recordPayment')} size="md"
        footer={<><button className="btn-secondary" disabled={saving} onClick={() => setPayOpen(false)}>{t('cancel')}</button><button className="btn-primary" disabled={saving || payAmount <= 0 || payAmount > (detail ? detailRemaining(detail, detailAcct, ledgerReady) : 0)} onClick={savePayment}>{saving ? <Check size={18} /> : t('save')}</button></>}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="text-sm font-medium">{detail.name}</span>
              <span className="text-sm font-bold text-error tabular-nums">{t('currentBalance')}: {formatMoney(detailRemaining(detail, detailAcct, ledgerReady), cur)}</span>
            </div>
            <div>
              <label className="label">{t('paidAmount')}</label>
              <input type="number" step="0.01" className="input text-xl font-bold tabular-nums text-center" value={payAmount} onChange={(e) => setPayAmount(Math.max(0, Number(e.target.value)))} />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(detailRemaining(detail, detailAcct, ledgerReady))}>{t('payAll')}</button>
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(Math.floor(detailRemaining(detail, detailAcct, ledgerReady) / 2))}>50%</button>
                <button className="btn-secondary py-2 text-sm tabular-nums" onClick={() => setPayAmount(1000)}>1000</button>
              </div>
            </div>
            <div>
              <label className="label">{t('paymentSource')}</label>
              <div className="grid grid-cols-2 gap-2">
                {([['cash_register', <Banknote size={18} />, t('paymentSourceRegister')], ['personal', <User size={18} />, t('paymentSourcePersonal')]] as const).map(([s, icon, label]) => (
                  <button key={s} type="button" className={`p-3 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-medium transition-all ${paySource === s ? 'border-accent bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => setPaySource(s)}>{icon} {label}</button>
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
              <span className="font-bold text-success tabular-nums">{formatMoney(Math.max(0, detailRemaining(detail, detailAcct, ledgerReady) - payAmount), cur)}</span>
            </div>
            {saveError && <div className="px-4 py-3 rounded-xl bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 text-sm">{saveError}</div>}
          </div>
        )}
      </Modal>

      {/* Statement Modal */}
      <Modal open={statementOpen} onClose={() => setStatementOpen(false)} title={t('supplierStatement')} size="lg"
        footer={<><button className="btn-secondary" onClick={() => setStatementOpen(false)}>{t('close')}</button><button className="btn-primary" onClick={() => window.print()}><Printer size={18} /> {t('print')}</button></>}>
        {detail && (
          <div>
            <div className="hidden print:block text-center mb-3">
              <p className="font-bold text-base">{storeName}</p>
              <p className="text-xs text-gray-500">{t('supplierStatement')} â€” {detail.name}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="table-header">{t('dateCol')}</th>
                    <th className="table-header">{t('type')}</th>
                    <th className="table-header">{t('amount')}</th>
                    <th className="table-header">{t('paid')}</th>
                    <th className="table-header">{t('remainingBalance')}</th>
                    <th className="table-header hidden md:table-cell">{t('notes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {statementRows.map((r) => (
                    <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(r.date, lang)}</td>
                      <td className="table-cell">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${r.type === 'purchase' ? 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400' : 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'}`}>
                          {r.type === 'purchase' ? <FileText size={12} /> : <Wallet size={12} />}
                          {r.type === 'purchase' ? t('purchase') : t('payment')}
                        </span>
                        {r.invoice && <span className="block text-[10px] text-gray-400 mt-0.5">{r.invoice}</span>}
                        {r.type === 'payment' && r.source && (
                          <span className="block text-[10px] text-gray-400 mt-0.5">{(r.source === 'cash_register' ? t('paymentSourceRegister') : t('paymentSourcePersonal'))}</span>
                        )}
                      </td>
                      <td className={`table-cell font-bold tabular-nums ${r.type === 'purchase' ? 'text-error' : 'text-success'}`}>{r.type === 'purchase' ? '+' : '-'}{formatMoney(r.amount, cur)}</td>
                      <td className="table-cell tabular-nums">{formatMoney(r.paid, cur)}</td>
                      <td className="table-cell tabular-nums text-gray-600 dark:text-gray-300">{formatMoney(r.remaining, cur)}</td>
                      <td className="table-cell hidden md:table-cell text-gray-500 text-xs">{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {statementRows.length === 0 && <EmptyState title={t('noData')} />}
          </div>
        )}
      </Modal>

      {/* Payment Receipt */}
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

function detailRemaining(s: Supplier, acct: ReturnType<typeof computeSupplierAccounts>[string] | null, ledgerReady: boolean): number {
  return ledgerReady ? (acct?.remaining ?? 0) : (Number(s.balance) || 0);
}