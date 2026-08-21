import { useEffect, useState, useCallback, useMemo, useDeferredValue } from 'react';
import { Plus, Search, Edit, Trash2, ReceiptText, AlertTriangle, UserRound, Banknote, User } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { apiFetch, ApiError } from '@/lib/api';
import { getExpenseCapability } from '@/lib/schema';
import { formatMoney, formatDate } from '@/lib/utils';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import SortableTh from '@/components/SortableTh';
import { useSort } from '@/hooks/useSort';
import { expenseCategoryLabel } from '@/lib/reporting';
import type { TranslationKey } from '@/lib/i18n';
import type { Expense, PaymentSource } from '@/types';

const PRESET_CATEGORIES = ['rent', 'electricity', 'water', 'transport', 'salaries', 'maintenance', 'equipment', 'other'] as const;
const CUSTOM = '__custom__';

const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const emptyForm = () => ({
  name: '',
  category: 'rent',
  customCategory: '',
  amount: '',
  payment_source: 'cash_register' as PaymentSource,
  expense_date: toInputDate(new Date()),
  description: '',
  notes: '',
});

export default function Expenses() {
  const { t, lang, settings, canModule, canFinance } = useApp();
  const canCreate = canModule('expenses', 'create');
  const canEdit = canModule('expenses', 'edit');
  const canDelete = canModule('expenses', 'delete');
  // Workers without the financial permission only ever receive their own
  // expenses (enforced server-side); the notice makes the scope explicit.
  const isScoped = !canFinance();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => toInputDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => toInputDate(new Date()));
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [formError, setFormError] = useState('');

  const cur = settings?.currency || 'DA';

  const load = useCallback(async () => {
    setLoading(true);
    const cap = await getExpenseCapability();
    if (cap === 'legacy') { setLegacy(true); setLoading(false); return; }
    setLegacy(false);
    // Include the recording user (relation select, supported by the local shim)
    // so the "Recorded by" column can show who entered the expense.
    const { data } = await supabase.from('expenses').select('*, user:users(full_name, username)').order('expense_date', { ascending: false });
    setExpenses((data || []) as Expense[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deferredSearch = useDeferredValue(search);

const displayCategory = useCallback((e: Expense) => expenseCategoryLabel(e.category, t), [t]);

  const recordedBy = useCallback((e: Expense) => {
    const u = e.user;
    if (!u) return null;
    return lang === 'ar' && u.full_name ? u.full_name : (u.full_name || u.username);
  }, [lang]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59`) : null;
    return expenses.filter((e) => {
      const d = new Date(e.expense_date);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (!q) return true;
      return (e.name || '').toLowerCase().includes(q)
        || (e.description || '').toLowerCase().includes(q)
        || (e.notes || '').toLowerCase().includes(q)
        || (e.category || '').toLowerCase().includes(q)
        || displayCategory(e).toLowerCase().includes(q);
    });
  }, [expenses, deferredSearch, from, to, displayCategory]);

  const total = useMemo(() => filtered.reduce((s, e) => s + Number(e.amount), 0), [filtered]);

  const accessors = useMemo(() => ({
    name: (e: Expense) => e.name,
    category: (e: Expense) => displayCategory(e),
    amount: (e: Expense) => Number(e.amount),
    payment_source: (e: Expense) => e.payment_source || 'cash_register',
    expense_date: (e: Expense) => new Date(e.expense_date),
    recorded_by: (e: Expense) => (e.user ? (e.user.full_name || e.user.username) : ''),
  }), [displayCategory]);

  const { sorted, key: sortKey, dir: sortDir, toggle } = useSort(filtered, accessors);

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setFormError(''); setModalOpen(true); };

  const openEdit = (e: Expense) => {
    const isPreset = (PRESET_CATEGORIES as readonly string[]).includes(e.category);
    setEditId(e.id || null);
    setForm({
      name: e.name,
      category: isPreset ? e.category : CUSTOM,
      customCategory: isPreset ? '' : e.category,
      amount: String(Number(e.amount)),
      payment_source: e.payment_source || (e.payment_method === 'cash' ? 'cash_register' : 'personal'),
      expense_date: toInputDate(new Date(e.expense_date)),
      description: e.description || '',
      notes: e.notes || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    const amount = Number(form.amount);
    if (!(amount >= 0)) return;
    const category = form.category === CUSTOM ? (form.customCategory.trim() || 'other') : form.category;
    const payload: Record<string, unknown> = {
      name,
      description: form.description.trim() || null,
      category,
      amount,
      payment_method: 'cash',
      payment_source: form.payment_source,
      expense_date: new Date(`${form.expense_date}T12:00:00`).toISOString(),
      notes: form.notes.trim() || null,
    };
    // Attribution: expenses are tied to the user who RECORDED them (the
    // server forces ownership on create, so editing never reassigns it).
    try {
      if (editId) {
        await apiFetch(`/api/expenses/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('error'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !deleteTarget.id) return;
    try {
      await apiFetch(`/api/expenses/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('error'));
    }
  };

  if (loading) return <FullPageSpinner />;

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
      <PageHeader title={t('expenses')} subtitle={`${expenses.length} ${t('totalItems')}`}
        actions={canCreate ? <button className="btn-primary" onClick={openAdd}><Plus size={18} /> {t('addExpense')}</button> : undefined} />

      {legacy && (
        <div className="card p-6 mb-4 flex items-start gap-3">
          <AlertTriangle className="text-warning shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold">{t('expensesNeedsMigration')}</p>
            <p className="text-sm text-gray-500">{t('expensesNeedsMigrationDesc')}</p>
          </div>
        </div>
      )}

      {!legacy && isScoped && (
        <div className="mb-4 rounded-2xl border border-accent/20 bg-accent-50 dark:bg-accent-900/20 px-4 py-3 flex items-center gap-3">
          <UserRound size={20} className="text-accent shrink-0" />
          <div>
            <p className="text-sm font-semibold text-accent-700 dark:text-accent-200">{t('myExpenses')}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('expensesScopeNotice')}</p>
          </div>
        </div>
      )}

      {!legacy && (
        <>
          <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
              <input className="input ps-10" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="label mb-0">{t('fromDate')}</label>
              <input type="date" className="input py-2" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="label mb-0">{t('toDate')}</label>
              <input type="date" className="input py-2" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20 mb-4">
            <p className="text-xs text-gray-500">{t('totalExpenses')}</p>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(total, cur)}</p>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <SortableTh label={t('expenseName')} k="name" activeKey={sortKey} dir={sortDir} onToggle={toggle} />
                  <SortableTh label={t('expenseCategory')} k="category" activeKey={sortKey} dir={sortDir} onToggle={toggle} />
                  <SortableTh label={t('expenseAmount')} k="amount" activeKey={sortKey} dir={sortDir} onToggle={toggle} align="end" />
                  <SortableTh label={t('paymentSource')} k="payment_source" activeKey={sortKey} dir={sortDir} onToggle={toggle} />
                  <SortableTh label={t('expenseDate')} k="expense_date" activeKey={sortKey} dir={sortDir} onToggle={toggle} />
                  <SortableTh label={t('recordedBy')} k="recorded_by" activeKey={sortKey} dir={sortDir} onToggle={toggle} />
                  <th className="table-header">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {sorted.map((e) => (
                  <tr key={e.id}>
                    <td className="table-cell font-medium">{e.name}</td>
                    <td className="table-cell"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{displayCategory(e)}</span></td>
                    <td className="table-cell font-bold tabular-nums text-end">{formatMoney(e.amount, cur)}</td>
                    <td className="table-cell">
                      <SourceBadge source={e.payment_source || (e.payment_method === 'cash' ? 'cash_register' : 'personal')} t={t} />
                    </td>
                    <td className="table-cell">{formatDate(e.expense_date, lang)}</td>
                    <td className="table-cell">
                      {recordedBy(e) ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300 flex items-center justify-center text-[10px] font-semibold uppercase shrink-0">{(recordedBy(e) || '?')[0]}</span>
                          <span className="text-sm">{recordedBy(e)}</span>
                        </span>
                      ) : <span className="text-gray-400">â€”</span>}
                    </td>
                    <td className="table-cell">
                      {(canEdit || canDelete) && (
                        <div className="flex gap-1 justify-end">
                          {canEdit && <button className="btn-ghost p-1.5 rounded-lg" onClick={() => openEdit(e)} title={t('edit')}><Edit size={16} /></button>}
                          {canDelete && <button className="btn-ghost p-1.5 rounded-lg text-error" onClick={() => setDeleteTarget(e)} title={t('delete')}><Trash2 size={16} /></button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 && <EmptyState title={t('noResults')} icon={<ReceiptText size={28} />} action={canCreate ? <button className="btn-primary" onClick={openAdd}><Plus size={18} /> {t('addExpense')}</button> : undefined} />}
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('editExpense') : t('addExpense')} size="md"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary" onClick={handleSave}>{t('save')}</button></>}>
        {formError && <div className="px-4 py-3 rounded-xl bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 text-sm mb-3">{formError}</div>}
        <div className="space-y-4">
          <div>
            <label className="label">{t('expenseName')} *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('expenseName')} />
          </div>
          <div>
            <label className="label">{t('expenseCategory')}</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {PRESET_CATEGORIES.map((c) => <option key={c} value={c}>{expenseCategoryLabel(c, t)}</option>)}
              <option value={CUSTOM}>{t('customCategory')}</option>
            </select>
            {form.category === CUSTOM && (
              <input className="input mt-2" value={form.customCategory} onChange={(e) => setForm({ ...form, customCategory: e.target.value })} placeholder={t('customCategory')} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('expenseAmount')} *</label>
              <input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('paymentSource')}</label>
              <div className="grid grid-cols-2 gap-2">
                {([['cash_register', <Banknote size={18} />, t('paymentSourceRegister')], ['personal', <User size={18} />, t('paymentSourcePersonal')]] as const).map(([s, icon, label]) => (
                  <button key={s} type="button" className={`p-2.5 rounded-xl border-2 flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${form.payment_source === s ? 'border-accent bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => setForm({ ...form, payment_source: s })}>{icon} {label}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="label">{t('expenseDate')}</label>
            <input type="date" className="input" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('description')}</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('notes')}</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('deleteExpense')} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button><button className="btn-danger" onClick={handleDelete}>{t('delete')}</button></>}>
        {formError && <div className="px-4 py-3 rounded-xl bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 text-sm mb-3">{formError}</div>}
        <p className="text-sm text-gray-500">{t('deleteConfirm')}</p>
        {deleteTarget && (
          <div className="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-sm">
            <p className="font-semibold">{deleteTarget.name}</p>
            <p className="text-gray-500">{displayCategory(deleteTarget)} â€” {formatMoney(deleteTarget.amount, cur)}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function SourceBadge({ source, t }: { source: string; t: (k: TranslationKey) => string }) {
  const register = source === 'cash_register';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${register ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300'}`}>
      {register ? <Banknote size={11} /> : <User size={11} />}
      {register ? t('paymentSourceRegister') : t('paymentSourcePersonal')}
    </span>
  );
}