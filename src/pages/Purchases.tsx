import { useEffect, useState, useCallback, useMemo, useDeferredValue } from 'react';
import { Plus, Search, Trash2, Pencil, ShoppingBag, X, Save, ImageIcon, Banknote, User } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { getLedgerCapability } from '@/lib/schema';
import { formatMoney, formatDate, generateInvoiceNumber } from '@/lib/utils';
import { FullPageSpinner } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import type { Product, Supplier, Purchase, PurchaseItem } from '@/types';
import type { PaymentSource } from '@/types';
import { isWeighed } from '@/types';

export default function Purchases() {
  const { t, lang, settings, canModule } = useApp();
  const canCreate = canModule('purchases', 'create');
  const canEdit = canModule('purchases', 'edit');
  const canDelete = canModule('purchases', 'delete');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '', invoice_number: '', notes: '',
    items: [] as (PurchaseItem & { product?: Product })[],
    discount: 0, tax: 0, paid: 0,
    payment_source: 'cash_register' as PaymentSource,
  });
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [itemBoxes, setItemBoxes] = useState(0);
  const [itemLoose, setItemLoose] = useState(1);
  const [itemPriceBox, setItemPriceBox] = useState(0);
  const [itemPriceUnit, setItemPriceUnit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ledgerReady, setLedgerReady] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLedgerReady((await getLedgerCapability()) === 'full');
    const [purRes, supRes, prodRes] = await Promise.all([
      supabase.from('purchases').select('*, supplier:suppliers(*), items:purchase_items(*)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
    ]);
    setPurchases((purRes.data || []) as Purchase[]);
    setSuppliers((supRes.data || []) as Supplier[]);
    setProducts((prodRes.data || []) as Product[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cur = settings?.currency || 'DA';
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => purchases.filter((p) => !deferredSearch || (p.invoice_number || '').toLowerCase().includes(deferredSearch.toLowerCase()) || (p.supplier?.name || '').toLowerCase().includes(deferredSearch.toLowerCase())), [purchases, deferredSearch]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      if ((s.name || '').toLowerCase().includes(q)) return true;
      if ((s.phone || '').toLowerCase().includes(q)) return true;
      if ((s.address || '').toLowerCase().includes(q)) return true;
      if ((s.notes || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }, [suppliers, supplierSearch]);

  const selectSupplier = (s: Supplier) => {
    setForm((f) => ({ ...f, supplier_id: s.id }));
    setSupplierPickerOpen(false);
    setSupplierSearch('');
  };

  const supplierRemainingMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of purchases) {
      if (p.supplier_id) m[p.supplier_id] = (m[p.supplier_id] || 0) + (Number(p.remaining) || 0);
    }
    return m;
  }, [purchases]);

  const openNew = () => {
    setEditing(null);
    setForm({ supplier_id: '', invoice_number: generateInvoiceNumber().replace('INV', 'PUR'), notes: '', items: [], discount: 0, tax: 0, paid: 0, payment_source: 'cash_register' });
    setModalOpen(true);
  };

  const openEdit = (p: Purchase) => {
    setEditing(p);
    setForm({
      supplier_id: p.supplier_id || '',
      invoice_number: p.invoice_number || '',
      notes: p.notes || '',
      items: (p.items || []).map((it) => ({ ...it, product: products.find((pr) => pr.id === it.product_id) })),
      discount: Number(p.discount) || 0,
      tax: Number(p.tax) || 0,
      paid: Number(p.paid) || 0,
      payment_source: (p.payment_source as PaymentSource) || 'cash_register',
    });
    setModalOpen(true);
  };

  const deferredProductSearch = useDeferredValue(productSearch);
  const filteredProducts = useMemo(() => {
    const q = deferredProductSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (!q) return true;
      const haystack = [p.name, p.name_ar, p.barcode, p.sku]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [products, deferredProductSearch]);

  // Packaging: box-capable products expose boxes + loose units; unit-only
  // products expose a plain quantity. Cost may be entered per box or per unit;
  // entering one derives the other so the normalized unit cost stays accurate.
  const isBoxProduct = (p: Product | null | undefined) => {
    if (isWeighed(p)) return false;
    const upb = Number(p?.units_per_box || 1);
    return upb > 1 && (p?.selling_type === 'box' || p?.selling_type === 'unit_box');
  };
  const weighedProduct = selectedProduct && isWeighed(selectedProduct);
  const boxProduct = selectedProduct && isBoxProduct(selectedProduct);
  const upb = Number(selectedProduct?.units_per_box || 1);
  const itemTotalUnits = weighedProduct
    ? itemLoose
    : boxProduct
      ? itemBoxes * upb + itemLoose
      : itemLoose;
  const itemSubtotal = weighedProduct
    ? itemLoose * itemPriceUnit
    : boxProduct
      ? itemBoxes * itemPriceBox + itemLoose * itemPriceUnit
      : itemLoose * itemPriceUnit;

  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    if (isWeighed(p)) {
      setItemBoxes(0);
      setItemLoose(1);
      setItemPriceBox(0);
      setItemPriceUnit(Number(p.purchase_price_box) || 0);
      return;
    }
    const upb2 = Number(p.units_per_box || 1);
    const boxy = upb2 > 1 && (p.selling_type === 'box' || p.selling_type === 'unit_box');
    const boxCost = Number(p.purchase_price_box) || 0;
    const unitCost = upb2 > 0 ? boxCost / upb2 : 0;
    setItemBoxes(boxy ? 1 : 0);
    setItemLoose(boxy ? 0 : 1);
    setItemPriceBox(boxCost);
    setItemPriceUnit(boxy ? unitCost : (Number(p.purchase_price_box) || 0));
  };

  const onPriceBox = (v: number) => {
    setItemPriceBox(v);
    if (upb > 0) setItemPriceUnit(Number((v / upb).toFixed(2)));
  };
  const onPriceUnit = (v: number) => {
    setItemPriceUnit(v);
    if (upb > 0) setItemPriceBox(Number((v * upb).toFixed(2)));
  };

  const addItem = () => {
    if (!selectedProduct || itemTotalUnits <= 0) return;
    const isW = isWeighed(selectedProduct);
    const newItem: PurchaseItem & { product?: Product } = {
      product_id: selectedProduct.id, name: selectedProduct.name,
      qty_boxes: 0,
      qty_loose_units: isW ? itemLoose : (boxProduct ? 0 : itemLoose),
      units_per_box: isW ? 1 : (boxProduct ? upb : 1),
      purchase_price_box: isW ? itemPriceUnit : (boxProduct ? itemPriceBox : itemPriceUnit),
      purchase_price_unit: itemPriceUnit,
      subtotal: itemSubtotal,
      product: selectedProduct,
    };
    setForm((f) => ({ ...f, items: [...f.items, newItem] }));
    setSelectedProduct(null); setProductSearch('');
    setItemBoxes(0); setItemLoose(1); setItemPriceBox(0); setItemPriceUnit(0);
  };

  const itemLabel = (it: PurchaseItem & { product?: Product }) => {
    const prod = it.product;
    if (prod && isWeighed(prod)) {
      const kg = Number(it.qty_loose_units) || 0;
      return `${kg} ${lang === 'ar' ? 'ÙƒØº' : 'KG'}`;
    }
    const boxes = Number(it.qty_boxes) || 0;
    const loose = Number(it.qty_loose_units) || 0;
    const upbx = Number(it.units_per_box) || 1;
    const totalUnits = boxes * upbx + loose;
    if (boxes > 0 && loose > 0) return `${boxes}Ã—${upbx} + ${loose} ${t('looseUnits')} = ${totalUnits} ${t('units')}`;
    if (boxes > 0) return `${boxes} ${t('boxes')} Ã— ${upbx} = ${totalUnits} ${t('units')}`;
    return `${totalUnits} ${t('units')}`;
  };
  const itemPriceLabel = (it: PurchaseItem & { product?: Product }) => {
    const prod = it.product;
    if (prod && isWeighed(prod)) {
      const unitPrice = Number(it.purchase_price_unit);
      return `${lang === 'ar' ? 'Ø§Ù„Ø³Ø¹Ø±/ÙƒØº' : 'Price/KG'}: ${formatMoney(unitPrice, cur)}`;
    }
    const boxes = Number(it.qty_boxes) || 0;
    const unitPrice = Number(it.purchase_price_unit);
    const boxPrice = Number(it.purchase_price_box);
    if (boxes > 0 && Number(it.qty_loose_units) > 0) {
      return `${t('costPerBox')}: ${formatMoney(boxPrice, cur)} Â· ${t('costPerUnit')}: ${formatMoney(unitPrice, cur)}`;
    }
    if (boxes > 0) return `${t('costPerBox')}: ${formatMoney(boxPrice, cur)}`;
    return `${t('costPerUnit')}: ${formatMoney(unitPrice || boxPrice, cur)}`;
  };

  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const subtotal = form.items.reduce((s, it) => s + Number(it.subtotal), 0);
  const total = subtotal - Number(form.discount) + Number(form.tax);
  const paid = Math.min(Math.max(0, Number(form.paid)), Math.max(0, total));
  const remaining = Math.max(0, total - paid);

  const handleSave = async () => {
    if (form.items.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        invoice_number: form.invoice_number,
        supplier_id: form.supplier_id || null,
        subtotal,
        discount: Number(form.discount),
        tax: Number(form.tax),
        total,
        paid,
        remaining,
        payment_source: form.payment_source,
        notes: form.notes,
        items: form.items.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          qty_boxes: Number(it.qty_boxes) || 0,
          qty_loose_units: Number(it.qty_loose_units) || 0,
          units_per_box: it.units_per_box,
          purchase_price_box: Number(it.purchase_price_box) || 0,
          purchase_price_unit: Number(it.purchase_price_unit) || 0,
          subtotal: Number(it.subtotal) || 0,
        })),
      };
      // The server creates/updates the purchase, its line items, stock
      // movements and the supplier ledger payment in a single transaction.
      if (editing) {
        await apiFetch(`/api/purchases/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/purchases', { method: 'POST', body: JSON.stringify(payload) });
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
    setModalOpen(false);
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // The server reverses the stock and removes ledger payments in a
      // transaction before deleting the purchase.
      await apiFetch(`/api/purchases/${deleteTarget.id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }
    setDeleting(false);
    setDeleteTarget(null);
    load();
  };

  if (loading) return <FullPageSpinner />;

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <PageHeader title={t('purchases')} subtitle={`${purchases.length} ${t('totalItems')}`}
        actions={canCreate ? <button className="btn-primary" onClick={openNew}><Plus size={18} /> {t('purchases')}</button> : undefined} />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
          <input className="input ps-10" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="table-header">{t('invoiceNumber')}</th>
                <th className="table-header">{t('supplier')}</th>
                <th className="table-header hidden md:table-cell">{t('dateCol')}</th>
                <th className="table-header hidden md:table-cell">{t('totalItems')}</th>
                <th className="table-header">{t('total')}</th>
                <th className="table-header">{t('amountPaid')}</th>
                <th className="table-header">{t('remainingBalance')}</th>
                <th className="table-header text-end">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="table-cell font-medium">{p.invoice_number || '-'}</td>
                  <td className="table-cell">{p.supplier?.name || '-'}</td>
                  <td className="table-cell hidden md:table-cell text-gray-500">{formatDate(p.created_at!, lang)}</td>
                  <td className="table-cell hidden md:table-cell">{p.items?.length || 0}</td>
                  <td className="table-cell font-bold tabular-nums">{formatMoney(p.total, cur)}</td>
                  <td className="table-cell text-success font-medium tabular-nums">{ledgerReady ? formatMoney(p.paid, cur) : formatMoney(p.paid ?? 0, cur)}
                      {Number(p.paid) > 0 && (
                        <span className={`ms-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded-full font-medium ${(p.payment_source || 'cash_register') === 'cash_register' ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300'}`}>
                          {(p.payment_source || 'cash_register') === 'cash_register' ? t('paymentSourceRegister') : t('paymentSourcePersonal')}
                        </span>
                      )}
                    </td>
                  <td className="table-cell">
                    <span className={`font-medium tabular-nums ${ledgerReady && Number(p.remaining) > 0 ? 'text-warning' : 'text-success'}`}>
                      {ledgerReady && Number(p.remaining) > 0 ? formatMoney(p.remaining, cur) : t('paid')}
                    </span>
                  </td>
                  <td className="table-cell text-end">
                    {(canEdit || canDelete) && (
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && <button className="btn-ghost p-1.5 rounded-lg" title={t('edit')} onClick={() => openEdit(p)}><Pencil size={16} /></button>}
                        {canDelete && <button className="btn-ghost p-1.5 rounded-lg text-error" title={t('delete')} onClick={() => setDeleteTarget(p)}><Trash2 size={16} /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <EmptyState title={t('noResults')} icon={<ShoppingBag size={28} />} />}
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? t('editPurchase') : t('purchases')} size="xl"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary" disabled={saving || form.items.length === 0} onClick={handleSave}><Save size={18} /> {t('save')}</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('supplier')}</label>
              {supplierPickerOpen ? (
                <div className="relative">
                  <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
                  <input className="input ps-9" autoFocus placeholder={t('searchSupplier')} value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    onBlur={() => setTimeout(() => setSupplierPickerOpen(false), 150)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setSupplierPickerOpen(false); setSupplierSearch(''); } }}
                  />
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredSuppliers.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">{t('noResults')}</div>
                    ) : (
                      filteredSuppliers.map((s) => (
                        <button key={s.id} type="button" className="w-full text-start px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => { e.preventDefault(); selectSupplier(s); }}>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{s.name}</p>
                            {s.phone && <p className="text-xs text-gray-500 truncate" dir="ltr">{s.phone}</p>}
                          </div>
                          {Number(s.balance) > 0 && <span className="text-xs font-semibold text-error tabular-nums shrink-0">{formatMoney(Number(s.balance), cur)}</span>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <button type="button" className="input w-full text-start flex items-center justify-between gap-2" onClick={() => setSupplierPickerOpen(true)}>
                  <span className={form.supplier_id ? 'truncate' : 'text-gray-400 truncate'}>
                    {suppliers.find((s) => s.id === form.supplier_id)?.name || t('selectSupplier')}
                  </span>
                  <Search size={14} className="shrink-0 text-gray-400" />
                </button>
              )}
            </div>
            <div><label className="label">{t('invoiceNumber')}</label><input className="input font-mono" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></div>
          </div>

          {/* Add product */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <label className="label">{t('addProductToPurchase')}</label>
            {!selectedProduct ? (
              <div>
                <div className="relative mb-2">
                  <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400" />
                  <input className="input ps-9 py-2 text-sm" placeholder={t('searchProduct')} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {filteredProducts.slice(0, 6).map((p) => (
                    <button key={p.id} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 text-start text-sm" onClick={() => selectProduct(p)}>
                      <div className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden flex items-center justify-center">{p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={12} className="text-gray-400" />}</div>
                      <span className="flex-1 truncate">{p.name}{p.name_ar && <span className="text-gray-400"> / {p.name_ar}</span>}</span>
                      {p.barcode && <span className="text-[10px] text-gray-400 font-mono" dir="ltr">{p.barcode}</span>}
                    </button>
                  ))}
                  {filteredProducts.length === 0 && <p className="p-2 text-xs text-gray-400">{t('noResults')}</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-accent-50 dark:bg-accent-900/20">
                  <span className="font-medium text-sm flex-1">{selectedProduct.name}{selectedProduct.name_ar && <span className="text-gray-400"> / {selectedProduct.name_ar}</span>}</span>
                  <span className="text-xs text-gray-400">{selectedProduct.sku ? `SKU: ${selectedProduct.sku}` : (selectedProduct.barcode || '')}</span>
                  <button className="btn-ghost p-1 rounded" onClick={() => setSelectedProduct(null)}><X size={14} /></button>
                </div>

                {weighedProduct ? (
                  <div>
                    <label className="label text-xs">{t('quantity')} (KG)</label>
                    <input type="number" step="0.001" min={0.001} className="input py-2 text-sm tabular-nums" value={itemLoose} onChange={(e) => setItemLoose(Math.max(0.001, Number(e.target.value)))} />
                  </div>
                ) : boxProduct ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="label text-xs">{t('boxes')}</label><input type="number" min={0} className="input py-2 text-sm tabular-nums" value={itemBoxes} onChange={(e) => setItemBoxes(Math.max(0, Number(e.target.value)))} /></div>
                    <div><label className="label text-xs">{t('unitsPerBox')}</label><input type="number" min={1} className="input py-2 text-sm tabular-nums" value={upb} disabled /></div>
                    <div><label className="label text-xs">{t('looseUnits')}</label><input type="number" min={0} max={upb - 1} className="input py-2 text-sm tabular-nums" value={itemLoose} onChange={(e) => setItemLoose(Math.max(0, Math.min(upb - 1, Number(e.target.value))))} /></div>
                  </div>
                ) : (
                  <div><label className="label text-xs">{t('quantity')}</label><input type="number" min={1} className="input py-2 text-sm tabular-nums" value={itemLoose} onChange={(e) => setItemLoose(Math.max(1, Number(e.target.value)))} /></div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {weighedProduct ? (
                    <div><label className="label text-xs">{t('costPerUnit')} (KG)</label><input type="number" step="0.01" min={0} className="input py-2 text-sm tabular-nums" value={itemPriceUnit} onChange={(e) => setItemPriceUnit(Number(e.target.value))} /></div>
                  ) : boxProduct ? (
                    <>
                      <div><label className="label text-xs">{t('costPerBox')}</label><input type="number" step="0.01" min={0} className="input py-2 text-sm tabular-nums" value={itemPriceBox} onChange={(e) => onPriceBox(Number(e.target.value))} /></div>
                      <div><label className="label text-xs">{t('costPerUnit')}</label><input type="number" step="0.01" min={0} className="input py-2 text-sm tabular-nums" value={itemPriceUnit} onChange={(e) => onPriceUnit(Number(e.target.value))} /></div>
                    </>
                  ) : (
                    <div><label className="label text-xs">{t('costPerUnit')}</label><input type="number" step="0.01" min={0} className="input py-2 text-sm tabular-nums" value={itemPriceUnit} onChange={(e) => setItemPriceUnit(Number(e.target.value))} /></div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">{weighedProduct ? `${t('totalUnits')}: ${itemTotalUnits} KG` : `${t('totalUnits')}: ${itemTotalUnits} ${t('units')}`}</p>
                  <p className="text-xs text-gray-500">{weighedProduct ? `+${itemTotalUnits} KG` : `${t('autoIncreaseStock')}: +${itemTotalUnits} ${t('units')}`}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">{t('subtotal')}: <span className="font-semibold tabular-nums">{formatMoney(itemSubtotal, cur)}</span></p>
                  <button className="btn-primary py-2 text-sm px-4" onClick={addItem} disabled={itemTotalUnits <= 0}><Plus size={16} /> {t('add')}</button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {form.items.length > 0 && (
            <div className="space-y-2">
              {form.items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div className="flex-1"><p className="text-sm font-medium">{it.name}</p><p className="text-xs text-gray-400">{itemLabel(it)}</p><p className="text-xs text-gray-400">{itemPriceLabel(it)}</p></div>
                  <span className="font-bold tabular-nums">{formatMoney(it.subtotal, cur)}</span>
                  <button className="btn-ghost p-1.5 rounded-lg text-error" onClick={() => removeItem(i)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('discount')}</label><input type="number" step="0.01" className="input tabular-nums" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></div>
            <div><label className="label">{t('tax')}</label><input type="number" step="0.01" className="input tabular-nums" value={form.tax} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) })} /></div>
          </div>

          <div className="p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20 flex justify-between items-center">
            <span className="font-semibold">{t('totalPurchase')}</span>
            <span className="text-xl font-bold tabular-nums">{formatMoney(total, cur)}</span>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-3">
            <div className="flex items-center justify-between">
              <label className="label">{t('amountPaid')}</label>
              <button className="btn-secondary py-1 px-3 text-xs" onClick={() => setForm({ ...form, paid: total })}>{t('payAll')}</button>
            </div>
            <div>
              <label className="label">{t('paymentSource')}</label>
              <div className="grid grid-cols-2 gap-2">
                {([['cash_register', <Banknote size={16} />, t('paymentSourceRegister')], ['personal', <User size={16} />, t('paymentSourcePersonal')]] as const).map(([s, icon, label]) => (
                  <button key={s} type="button" className={`p-2.5 rounded-xl border-2 flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${form.payment_source === s ? 'border-accent bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => setForm({ ...form, payment_source: s })}>{icon} {label}</button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">{form.payment_source === 'cash_register' ? t('cashPurchases') : t('paymentSourcePersonal')}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['full', 'partial', 'account'] as const).map((m) => ({ m, label: m === 'full' ? t('fullPayment') : m === 'partial' ? t('partialPayment') : t('onAccount') })).map(({ m, label }) => {
                const active = total > 0 && (m === 'full' ? form.paid >= total : m === 'partial' ? form.paid > 0 && form.paid < total : form.paid <= 0);
                return (
                  <button key={m} className={`py-2 text-xs font-medium rounded-xl border-2 transition-all ${active ? 'border-accent bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`} onClick={() => setForm({ ...form, paid: m === 'full' ? total : 0 })}>{label}</button>
                );
              })}
            </div>
            <input type="number" step="0.01" min={0} className="input text-xl font-bold tabular-nums text-center" placeholder={t(form.paid > 0 && form.paid < total ? 'partialPayment' : 'amountPaid')} value={form.paid} onChange={(e) => setForm({ ...form, paid: Number(e.target.value) })} />
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{t('remainingBalance')}</span>
              <span className={`font-bold tabular-nums ${remaining > 0 ? 'text-warning' : 'text-success'}`}>{formatMoney(remaining, cur)}</span>
            </div>
            {form.supplier_id && (
              <p className="text-xs text-gray-400">{t('afterInvoice')}: {formatMoney((supplierRemainingMap[form.supplier_id] || 0) + remaining, cur)}</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('deletePurchase')}>
        <p className="text-sm text-gray-500">{t('deleteConfirm')}</p>
        {deleteTarget && (
          <div className="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-sm">
            <p className="font-semibold">{deleteTarget.invoice_number || '-'}</p>
            <p className="text-gray-500">{deleteTarget.supplier?.name || '-'} â€” {formatMoney(deleteTarget.total, cur)}</p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
          <button className="btn-primary bg-error hover:bg-error/90" disabled={deleting} onClick={confirmDelete}><Trash2 size={16} /> {t('delete')}</button>
        </div>
      </Modal>
    </div>
  );
}
