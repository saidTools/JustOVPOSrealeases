export type SellingType = 'unit' | 'box' | 'unit_box' | 'weighed';
export type PaymentMethod = 'cash' | 'card' | 'ccp' | 'credit' | 'split';
export type UserRole = 'admin' | 'manager' | 'cashier';
export type SaleStatus = 'completed' | 'held' | 'returned' | 'refunded';
export type StockMoveType = 'in' | 'out' | 'adjust';
export type CashTxType = 'opening' | 'sale' | 'refund' | 'credit_collection' | 'expense' | 'supplier_payment' | 'purchase' | 'withdrawal' | 'deposit';
export type PaymentSource = 'cash_register' | 'personal';

export interface Category {
  id: string;
  name: string;
  name_ar: string | null;
  icon: string | null;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  balance: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  name_ar: string | null;
  barcode: string | null;
  sku: string | null;
  category_id: string | null;
  brand: string | null;
  supplier_id: string | null;
  description: string | null;
  image_url: string | null;
  selling_type: SellingType;
  units_per_box: number;
  purchase_price_box: number;
  selling_price_unit: number;
  selling_price_box: number;
  current_stock: number;
  min_stock_alert: number;
  expiration_date: string | null;
  status: 'active' | 'inactive';
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  category?: Category;
  supplier?: Supplier;
}

export interface StockMovement {
  id: string;
  product_id: string;
  type: StockMoveType;
  reason: string | null;
  quantity: number;
  balance_after: number | null;
  ref_type: string | null;
  ref_id: string | null;
  user_id: string | null;
  created_at: string;
  product?: Product;
}

export interface User {
  id: string;
  username: string;
  full_name: string | null;
  /** Only present in legacy shim reads; the users API never returns it. */
  password_hash?: string;
  role: UserRole;
  permissions: string[];
  active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface SaleItem {
  id?: string;
  sale_id?: string;
  product_id: string | null;
  name: string;
  barcode: string | null;
  sell_as: 'unit' | 'box' | 'kg';
  qty: number;
  price: number;
  discount: number;
  subtotal: number;
  refunded_qty?: number;
}

export interface Sale {
  id?: string;
  invoice_number: string;
  customer_id: string | null;
  cashier_id: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  notes: string | null;
  refunded_amount?: number;
  created_at?: string;
  customer?: Customer;
  cashier?: User;
  items?: SaleItem[];
}

export interface Payment {
  id?: string;
  customer_id: string;
  sale_id: string | null;
  amount: number;
  payment_method: 'cash' | 'card' | 'ccp' | 'credit';
  notes: string | null;
  user_id: string | null;
  created_at?: string;
  customer?: Customer;
}

export interface SalePayment {
  id?: string;
  sale_id: string;
  method: 'cash' | 'card' | 'ccp' | 'credit';
  amount: number;
  status: string;
  reference: string | null;
  user_id: string | null;
  created_at?: string;
}

export interface CashSession {
  id: string;
  opened_by: string;
  opening_balance: number;
  status: 'open' | 'closed';
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  opener?: { id: string; username: string; full_name: string | null } | null;
  closer?: { id: string; username: string; full_name: string | null } | null;
  transactions?: CashTransaction[];
  _count?: { transactions: number };
}

export interface CashTransaction {
  id: string;
  session_id: string | null;
  type: CashTxType;
  amount: number;
  payment_method: string | null;
  user_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_at: string;
  user?: { id: string; username: string; full_name: string | null } | null;
}

export interface Purchase {
  id?: string;
  invoice_number: string | null;
  supplier_id: string | null;
  user_id: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  remaining: number;
  payment_source?: PaymentSource;
  notes: string | null;
  created_at?: string;
  supplier?: Supplier;
  items?: PurchaseItem[];
}

export interface PurchaseItem {
  id?: string;
  purchase_id?: string;
  product_id: string | null;
  name: string;
  qty_boxes: number;
  qty_loose_units?: number;
  units_per_box: number;
  purchase_price_box: number;
  purchase_price_unit?: number;
  subtotal: number;
}

export interface Expense {
  id?: string;
  name: string;
  description: string | null;
  category: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'ccp' | 'credit';
  payment_source?: PaymentSource;
  expense_date: string;
  notes: string | null;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: { full_name: string | null; username: string } | null;
}

export interface SupplierPayment {
  id?: string;
  supplier_id: string;
  purchase_id: string | null;
  amount: number;
  payment_method: 'cash' | 'credit';
  payment_source?: PaymentSource;
  notes: string | null;
  user_id: string | null;
  created_at?: string;
  supplier?: Supplier;
  purchase?: Purchase;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface Settings {
  id: number;
  store_name: string;
  store_name_ar: string | null;
  commercial_register: string | null;
  tax_number: string | null;
  phone: string | null;
  address: string | null;
  address_ar: string | null;
  logo_url: string | null;
  currency: string;
  currency_ar: string | null;
  tax_rate: number;
  receipt_width: '58mm' | '80mm' | 'a4';
  theme: 'light' | 'dark';
  language: 'en' | 'ar' | 'fr';
  auto_backup: boolean;
  footer_message: string | null;
  footer_message_ar: string | null;
  cash_register_enabled?: boolean;
  cash_auto_close_enabled?: boolean;
  cash_auto_close_time?: string;
  cash_schedule_enabled?: boolean;
  cash_open_time?: string;
  cash_prevent_early_open?: boolean;
  cash_allow_reopen_after_close?: boolean;
  updated_at: string;
}

export function isService(p: Product | { sku?: string | null }): boolean {
  return (p.sku || '').startsWith('SVC-');
}

export function isWeighed(p: Product | { selling_type?: SellingType }): boolean {
  return p.selling_type === 'weighed';
}

export interface ReceiptTemplate {
  id: string;
  name: string;
  width: string;
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
}
