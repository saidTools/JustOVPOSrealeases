import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Wallet, Play, Pause, ArrowDownCircle, ArrowUpCircle, Banknote, CreditCard as CreditCardIcon,
  Landmark, User, History, ShieldCheck, AlertTriangle, Check, X, Clock, ShoppingCart,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { apiFetch, ApiError } from '@/lib/api';
import { formatMoney, formatDateTime } from '@/lib/utils';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import type { CashSession, CashTransaction } from '@/types';
import type { CashTxType } from '@/types';

interface Summary {
  byMethod: Record<string, number>;
  collections: number;
  collectionCount: number;
  movements: Record<string, { amount: number; count: number }>;
  openSession: { id: string; opened_by: string; opening_balance: number; opened_at: string } | null;
  cardPayments: {
    id: string; amount: number; invoice: string | null; total: number | null;
    refunded: number; customer: string | null; user: string | null;
    reference: string | null; status: string; created_at: string;
  }[];
}

type RangeKey = 'today' | 'week' | 'month' | 'year';

function rangeFor(key: RangeKey): { from: string; to: string } {
  const from = new Date();
  const to = new Date();
  if (key === 'today') {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else if (key === 'week') {
    const day = (from.getDay() + 6) % 7; // Monday start
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else if (key === 'month') {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const TX_ICONS: Record<CashTxType, React.ReactNode> = {
  opening: <Play size={16} />,
  sale: <Banknote size={16} />,
  refund: <X size={16} />,
  credit_collection: <Wallet size={16} />,
  expense: <ArrowDownCircle size={16} />,
  supplier_payment: <ArrowDownCircle size={16} />,
  purchase: <ShoppingCart size={16} />,
  withdrawal: <ArrowUpCircle size={16} />,
  deposit: <ArrowDownCircle size={16} />,
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  ccp: 'ccp',
  credit: 'credit',
};

export default function Caisse() {
  const { t, lang, settings, canFinance, currentUser } = useApp();
  const canManage = canFinance() || currentUser?.role === 'admin';
  const cashRegisterEnabled = Boolean(settings?.cash_register_enabled);
  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [range, setRange] = useState<RangeKey>('today');

  // Open-session modal
  const [showOpen, setShowOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [sessionNote, setSessionNote] = useState('');
  // Close-session modal
  const [showClose, setShowClose] = useState(false);
  const [actualCash, setActualCash] = useState(0);
  const [expectedCash, setExpectedCash] = useState(0);
  // Manual movement modal
  const [showMovement, setShowMovement] = useState(false);
  const [movementType, setMovementType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementNote, setMovementNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [schedule, setSchedule] = useState<{
    enabled: boolean;
    openTime: string;
    preventEarlyOpen: boolean;
    autoCloseEnabled: boolean;
    autoCloseTime: string;
    canOpen: boolean;
    reason: 'TOO_EARLY' | 'DAY_ENDED' | null;
    nextOpenTime: string;
    pastAutoCloseTime: boolean;
  } | null>(null);

  const cur = settings?.currency || 'DA';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [openRes, sessionsRes, txRes, statusRes] = await Promise.all([
        apiFetch<{ data: CashSession[] }>('/api/cashier/sessions?status=open&limit=5'),
        apiFetch<{ data: CashSession[] }>('/api/cashier/sessions?limit=10'),
        apiFetch<{ data: CashTransaction[] }>('/api/cashier/transactions?limit=100'),
        apiFetch<{ schedule: typeof schedule }>('/api/cashier/status').catch(() => ({ schedule: null })),
      ]);
      setOpenSession(openRes.data?.[0] || null);
      setSessions(sessionsRes.data || []);
      setTransactions(txRes.data || []);
      setSchedule(statusRes.schedule || null);
      if (canFinance()) {
        const r = rangeFor(range);
        const s = await apiFetch<Summary>(`/api/cashier/summary?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`);
        setSummary(s);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [t, canFinance, range]);

  useEffect(() => { load(); }, [load]);

  const scheduleError = (e: unknown) => {
    // Map the backend schedule-restriction codes to localized messages.
    if (e instanceof ApiError) {
      const code = (e.body as { error?: { code?: string } })?.error?.code;
      const time = schedule?.nextOpenTime || schedule?.openTime || '08:00';
      if (code === 'CASH_SCHEDULE_TOO_EARLY') return t('cashCannotOpenBefore').replace('{time}', time);
      if (code === 'CASH_SCHEDULE_DAY_ENDED') return t('cashSessionEndedToday').replace('{time}', time);
      return e.message;
    }
    return t('error');
  };

  const open = async () => {
    if (cashRegisterEnabled && openingBalance <= 0) {
      setError(t('openingBalanceRequired'));
      setBusy(false);
      return;
    }
    setBusy(true); setError('');
    try {
      const s = await apiFetch<CashSession>('/api/cashier/sessions', {
        method: 'POST',
        body: JSON.stringify({ opening_balance: Number(openingBalance) || 0, notes: sessionNote.trim() || null }),
      });
      setOpenSession(s);
      setShowOpen(false);
      setOpeningBalance(0); setSessionNote('');
      setNotice(t('sessionOpened'));
      load();
    } catch (e) {
      setError(scheduleError(e));
    } finally { setBusy(false); }
  };

  const openCloseModal = async () => {
    setError('');
    try {
      const detail = await apiFetch<CashSession>(`/api/cashier/sessions/${openSession?.id}`);
      const txs = detail.transactions || [];
      const expected = (openSession?.opening_balance || 0) + txs.filter((x) => x.type !== 'opening').reduce((s, x) => s + Number(x.amount), 0);
      setExpectedCash(expected);
      setActualCash(expected);
      setShowClose(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error'));
    }
  };

  const close = async () => {
    if (!openSession) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/cashier/sessions/${openSession.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ actual_cash: Number(actualCash) }),
      });
      setShowClose(false);
      setOpenSession(null);
      setNotice(t('sessionClosedNotice'));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error'));
    } finally { setBusy(false); }
  };

  const doMovement = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch('/api/cashier/transactions', {
        method: 'POST',
        body: JSON.stringify({ type: movementType, amount: Number(movementAmount), note: movementNote.trim() || null }),
      });
      setShowMovement(false);
      setMovementAmount(0); setMovementNote('');
      setNotice(movementType === 'deposit' ? t('depositDone') : t('withdrawalDone'));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error'));
    } finally { setBusy(false); }
  };

  const txLabel = (tx: CashTransaction) => {
    const map: Record<CashTxType, string> = {
      opening: t('txOpening'), sale: t('txSale'), refund: t('txRefund'), credit_collection: t('txCollection'),
      expense: t('txExpense'), supplier_payment: t('txSupplierPayment'), purchase: t('txPurchase'), withdrawal: t('txWithdrawal'), deposit: t('txDeposit'),
    };
    return map[tx.type] || tx.type;
  };

  const movements = summary?.movements || {};

  const methodCards = useMemo(() => {
    const methods: { key: string; label: string; value: number }[] = [
      { key: 'cash', label: t('cash'), value: summary?.byMethod.cash || 0 },
      { key: 'card', label: t('card'), value: summary?.byMethod.card || 0 },
      { key: 'ccp', label: t('ccp'), value: summary?.byMethod.ccp || 0 },
      { key: 'credit', label: t('credit'), value: summary?.byMethod.credit || 0 },
    ];
    return methods;
  }, [summary, t]);

  if (loading) return <FullPageSpinner />;

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      <PageHeader title={t('caisse')} subtitle={openSession ? t('sessionOpenDesc') : t('sessionClosedDesc')}
        actions={canManage ? (
          <div className="flex gap-2">
            {openSession ? (
              <>
                <button className="btn-secondary" onClick={() => { setMovementType('deposit'); setMovementAmount(0); setMovementNote(''); setShowMovement(true); }}><ArrowDownCircle size={18} /> {t('deposit')}</button>
                <button className="btn-secondary" onClick={() => { setMovementType('withdrawal'); setMovementAmount(0); setMovementNote(''); setShowMovement(true); }}><ArrowUpCircle size={18} /> {t('withdrawal')}</button>
                <button className="btn-danger" onClick={openCloseModal}><Pause size={18} /> {t('closeSession')}</button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => { setOpeningBalance(0); setSessionNote(''); setShowOpen(true); }}><Play size={18} /> {t('openSession')}</button>
            )}
          </div>
        ) : undefined} />

      {notice && (
        <div className="rounded-2xl border border-success/30 bg-success-50 dark:bg-success-900/20 px-4 py-3 flex items-center gap-2 text-sm text-success-700 dark:text-success-300">
          <Check size={16} /> {notice}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-error/30 bg-error-50 dark:bg-error-900/20 px-4 py-3 flex items-center gap-2 text-sm text-error-700 dark:text-error-400">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Opening schedule / restriction banner (admin-configured) */}
      {!openSession && schedule?.enabled && !canManage && schedule.reason === 'TOO_EARLY' && (
        <div className="rounded-2xl border border-warning/30 bg-warning-50 dark:bg-warning-900/20 px-4 py-3 flex items-center gap-2 text-sm text-warning-700 dark:text-warning-300">
          <Clock size={16} className="shrink-0" />
          {t('cashCannotOpenBefore').replace('{time}', schedule.nextOpenTime)}
        </div>
      )}
      {!openSession && schedule?.enabled && !canManage && schedule.reason === 'DAY_ENDED' && (
        <div className="rounded-2xl border border-warning/30 bg-warning-50 dark:bg-warning-900/20 px-4 py-3 flex items-center gap-2 text-sm text-warning-700 dark:text-warning-300">
          <Clock size={16} className="shrink-0" />
          {t('cashSessionEndedToday').replace('{time}', schedule.nextOpenTime)}
        </div>
      )}
      {openSession && schedule?.enabled && schedule.pastAutoCloseTime && (
        <div className="rounded-2xl border border-warning/30 bg-warning-50 dark:bg-warning-900/20 px-4 py-3 flex items-center gap-2 text-sm text-warning-700 dark:text-warning-300">
          <Clock size={16} className="shrink-0" />
          {t('cashAutoClosedAt').replace('{time}', schedule.autoCloseTime)}
        </div>
      )}

      {/* Session status card */}
      <div className={`card p-5 ${openSession ? '' : 'border-dashed'}`}>
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${openSession ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>
            {openSession ? <Play size={20} /> : <Pause size={20} />}
          </span>
          <div>
            <h3 className="font-semibold">{openSession ? t('sessionOpen') : t('sessionClosed')}</h3>
            <p className="text-xs text-gray-400">{openSession ? t('sessionOpenDesc') : t('sessionClosedDesc')}</p>
          </div>
        </div>
        {openSession ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-400">{t('openedBy')}</p>
              <p className="font-semibold text-sm mt-0.5">{openSession.opener?.full_name || openSession.opener?.username || openSession.opened_by}</p>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-400">{t('openedAt')}</p>
              <p className="font-semibold text-sm mt-0.5">{formatDateTime(openSession.opened_at, lang)}</p>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-400">{t('openingBalance')}</p>
              <p className="font-bold text-sm mt-0.5 tabular-nums">{formatMoney(openSession.opening_balance, cur)}</p>
            </div>
            <div className="p-3 rounded-xl bg-accent-50 dark:bg-accent-900/20">
              <p className="text-xs text-gray-400">{t('cashInRegister')}</p>
              <p className="font-bold text-sm mt-0.5 tabular-nums text-accent">{formatMoney((openSession.opening_balance || 0) + transactions.filter((x) => x.session_id === openSession.id && x.type !== 'opening').reduce((s, x) => s + Number(x.amount), 0), cur)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t('noOpenSession')}</p>
        )}
      </div>

      {/* Payment methods + drawer summary (financial permission) */}
      {canFinance() && (
        <div className="card p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><ShieldCheck size={18} /></span>
              <div>
                <h3 className="font-semibold text-[15px]">{t('paymentMethodsSummary')}</h3>
                <p className="text-xs text-gray-400">{t('summaryNote')}</p>
              </div>
            </div>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
              {(['today', 'week', 'month', 'year'] as RangeKey[]).map((k) => (
                <button key={k} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${range === k ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} onClick={() => setRange(k)}>{t(k)}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {methodCards.map((m) => (
              <div key={m.key} className="p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  {m.key === 'cash' ? <Banknote size={16} className="text-success" /> : m.key === 'card' ? <CreditCardIcon size={16} className="text-accent" /> : m.key === 'ccp' ? <Landmark size={16} className="text-violet-500" /> : <User size={16} className="text-warning" />}
                  <span className="text-xs text-gray-500">{t(METHOD_LABELS[m.key] as 'cash')}</span>
                </div>
                <p className="text-lg font-bold tabular-nums">{formatMoney(m.value, cur)}</p>
                <p className="text-[10px] text-gray-400">{t(m.key === 'credit' ? 'creditIsReceivable' : 'salesPaidBy')}</p>
              </div>
            ))}
            <div className="p-4 rounded-xl border border-success/30 bg-success-50 dark:bg-success-900/20">
              <p className="text-xs text-gray-500 mb-2">{t('collections')}</p>
              <p className="text-lg font-bold text-success tabular-nums">{formatMoney(summary?.collections || 0, cur)}</p>
              <p className="text-[10px] text-gray-400">{summary?.collectionCount || 0} {t('count')}</p>
            </div>
          </div>

          {/* Drawer movement breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[
              ['sale', t('cashSales'), movements.sale?.amount || 0, 'text-success'],
              ['credit_collection', t('cashCollections'), movements.credit_collection?.amount || 0, 'text-success'],
              ['deposit', t('deposits'), movements.deposit?.amount || 0, 'text-success'],
              ['expense', t('cashExpenses'), movements.expense?.amount || 0, 'text-error'],
              ['refund', t('cashRefunds'), movements.refund?.amount || 0, 'text-error'],
              ['withdrawal', t('withdrawals'), movements.withdrawal?.amount || 0, 'text-error'],
              ['supplier_payment', t('cashSupplierPayments'), movements.supplier_payment?.amount || 0, 'text-error'],
              ['purchase', t('cashPurchases'), movements.purchase?.amount || 0, 'text-error'],
            ].map(([k, label, val, tone]) => (
              <div key={k as string} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                <span className="text-xs text-gray-500">{label as string}</span>
                <span className={`font-bold text-sm tabular-nums ${tone as string}`}>{formatMoney(Number(val), cur)}</span>
              </div>
            ))}
          </div>

          {/* Card payments history */}
          <h4 className="font-semibold text-sm mt-6 mb-3 flex items-center gap-2"><CreditCardIcon size={16} className="text-accent" /> {t('cardHistory')}</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('invoice')}</th>
                  <th className="table-header text-end">{t('amount')}</th>
                  <th className="table-header text-end">{t('refundedItems')}</th>
                  <th className="table-header">{t('customer')}</th>
                  <th className="table-header">{t('cashier')}</th>
                  <th className="table-header">{t('dateCol')}</th>
                  <th className="table-header">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {(summary?.cardPayments || []).length === 0 && (
                  <tr><td colSpan={7}><div className="py-8"><EmptyState title={t('noCardPayments')} /></div></td></tr>
                )}
                {(summary?.cardPayments || []).map((cp) => (
                  <tr key={cp.id}>
                    <td className="table-cell font-medium">{cp.invoice || '-'}</td>
                    <td className="table-cell font-bold tabular-nums text-end">{formatMoney(cp.amount, cur)}</td>
                    <td className="table-cell text-end tabular-nums">{cp.refunded > 0 ? formatMoney(cp.refunded, cur) : '-'}</td>
                    <td className="table-cell">{cp.customer || t('walkIn')}</td>
                    <td className="table-cell">{cp.user || '-'}</td>
                    <td className="table-cell">{formatDateTime(cp.created_at, lang)}</td>
                    <td className="table-cell"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300">{t('cardRecorded')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><History size={18} /></span>
          <div>
            <h3 className="font-semibold text-[15px]">{t('cashTransactions')}</h3>
            <p className="text-xs text-gray-400">{t('cashTransactionsDesc')}</p>
          </div>
        </div>
        {transactions.length === 0 ? (
          <EmptyState title={t('noTransactions')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('type')}</th>
                  <th className="table-header text-end">{t('amount')}</th>
                  <th className="table-header">{t('note')}</th>
                  <th className="table-header">{t('user')}</th>
                  <th className="table-header">{t('dateCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center ${Number(tx.amount) >= 0 ? 'bg-success-50 text-success dark:bg-success-900/30' : 'bg-error-50 text-error dark:bg-error-900/30'}`}>{TX_ICONS[tx.type]}</span>
                        <span className="font-medium text-sm">{txLabel(tx)}</span>
                      </span>
                    </td>
                    <td className={`table-cell font-bold tabular-nums text-end ${Number(tx.amount) >= 0 ? 'text-success' : 'text-error'}`}>
                      {Number(tx.amount) >= 0 ? '+' : ''}{formatMoney(tx.amount, cur)}
                    </td>
                    <td className="table-cell text-sm">{tx.note || '-'}</td>
                    <td className="table-cell text-sm">{tx.user?.full_name || tx.user?.username || '-'}</td>
                    <td className="table-cell">{formatDateTime(tx.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sessions history */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center"><Pause size={18} /></span>
          <div>
            <h3 className="font-semibold text-[15px]">{t('sessionsHistory')}</h3>
            <p className="text-xs text-gray-400">{t('sessionsHistoryDesc')}</p>
          </div>
        </div>
        {sessions.length === 0 ? (
          <EmptyState title={t('noSessions')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="table-header">{t('openedAt')}</th>
                  <th className="table-header">{t('openedBy')}</th>
                  <th className="table-header text-end">{t('openingBalance')}</th>
                  <th className="table-header text-end">{t('expectedCash')}</th>
                  <th className="table-header text-end">{t('actualCash')}</th>
                  <th className="table-header text-end">{t('difference')}</th>
                  <th className="table-header">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="table-cell">{formatDateTime(s.opened_at, lang)}</td>
                    <td className="table-cell">{s.opener?.full_name || s.opener?.username || s.opened_by}</td>
                    <td className="table-cell text-end tabular-nums">{formatMoney(s.opening_balance, cur)}</td>
                    <td className="table-cell text-end tabular-nums">{s.expected_cash !== null ? formatMoney(s.expected_cash, cur) : '-'}</td>
                    <td className="table-cell text-end tabular-nums">{s.actual_cash !== null ? formatMoney(s.actual_cash, cur) : '-'}</td>
                    <td className="table-cell text-end tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className={`font-semibold ${Number(s.difference) !== 0 ? (Number(s.difference) > 0 ? 'text-success' : 'text-error') : ''}`}>{s.difference !== null ? formatMoney(s.difference, cur) : '-'}</span>
                        {s.difference !== null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 ${Number(s.difference) === 0 ? 'bg-success-50 text-success dark:bg-success-900/30' : Number(s.difference) > 0 ? 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' : 'bg-error-50 text-error dark:bg-error-900/30'}`}>
                            {Number(s.difference) === 0 ? t('balanced') : Number(s.difference) > 0 ? t('surplus') : t('shortage')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'open' ? 'bg-success-50 text-success dark:bg-success-900/30' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{s.status === 'open' ? t('open') : t('closed')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open session modal */}
      <Modal open={showOpen} onClose={() => setShowOpen(false)} title={t('openSession')} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setShowOpen(false)}>{t('cancel')}</button><button className="btn-primary" disabled={busy || (cashRegisterEnabled && openingBalance <= 0)} onClick={open}><Play size={18} /> {t('confirm')}</button></>}>
        <div className="space-y-3">
          {error && <div className="px-3 py-2 rounded-lg bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 text-xs">{error}</div>}
          <div>
            <label className="label">{t('openingBalance')} {cashRegisterEnabled ? <span className="font-normal text-error">*</span> : <span className="font-normal text-gray-400">({t('optional')})</span>}</label>
            <input type="number" step="0.01" min="0" className="input text-xl font-bold tabular-nums text-center" value={openingBalance} onChange={(e) => setOpeningBalance(Math.max(0, Number(e.target.value)))} placeholder={cashRegisterEnabled ? '' : t('optional')} autoFocus />
          </div>
          <div>
            <label className="label">{t('note')}</label>
            <input className="input" value={sessionNote} onChange={(e) => setSessionNote(e.target.value)} placeholder={t('optional')} />
          </div>
        </div>
      </Modal>

      {/* Close session modal */}
      <Modal open={showClose} onClose={() => setShowClose(false)} title={t('closeSession')} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setShowClose(false)}>{t('cancel')}</button><button className="btn-danger" disabled={busy} onClick={close}><Pause size={18} /> {t('confirmClose')}</button></>}>
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 flex justify-between">
            <span className="text-sm">{t('expectedCash')}</span>
            <span className="font-bold tabular-nums">{formatMoney(expectedCash, cur)}</span>
          </div>
          <div>
            <label className="label">{t('actualCash')}</label>
            <input type="number" step="0.01" min="0" className="input text-xl font-bold tabular-nums text-center" value={actualCash} onChange={(e) => setActualCash(Math.max(0, Number(e.target.value)))} autoFocus />
          </div>
          <div className={`p-3 rounded-xl flex justify-between items-center ${Number(actualCash) - expectedCash === 0 ? 'bg-success-50 dark:bg-success-900/20' : 'bg-warning-50 dark:bg-warning-900/20'}`}>
            <span className="text-sm">{t('difference')}</span>
            <div className="flex items-center gap-2">
              <span className={`font-bold tabular-nums ${Number(actualCash) - expectedCash >= 0 ? 'text-success' : 'text-error'}`}>{formatMoney(Number(actualCash) - expectedCash, cur)}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${Number(actualCash) - expectedCash === 0 ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' : Number(actualCash) - expectedCash > 0 ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' : 'bg-error-100 text-error dark:bg-error-900/30'}`}>
                {Number(actualCash) - expectedCash === 0 ? t('balanced') : Number(actualCash) - expectedCash > 0 ? t('surplus') : t('shortage')}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Manual movement modal */}
      <Modal open={showMovement} onClose={() => setShowMovement(false)} title={movementType === 'deposit' ? t('deposit') : t('withdrawal')} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setShowMovement(false)}>{t('cancel')}</button><button className={movementType === 'deposit' ? 'btn-primary' : 'btn-danger'} disabled={busy || movementAmount <= 0} onClick={doMovement}><Check size={18} /> {t('confirm')}</button></>}>
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{movementType === 'deposit' ? t('depositDesc') : t('withdrawalDesc')}</p>
          <div>
            <label className="label">{t('amount')}</label>
            <input type="number" step="0.01" min="0" className="input text-xl font-bold tabular-nums text-center" value={movementAmount} onChange={(e) => setMovementAmount(Math.max(0, Number(e.target.value)))} autoFocus />
          </div>
          <div>
            <label className="label">{t('note')}</label>
            <input className="input" value={movementNote} onChange={(e) => setMovementNote(e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
