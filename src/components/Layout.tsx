import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Truck, Users, ShoppingBag,
  CreditCard, BookOpen, Wallet, Barcode, BarChart3, Settings, Receipt,
  UserCog, ScrollText, DatabaseBackup, Moon, Sun, LogOut, Menu, ZoomIn, ZoomOut,
  Store, ChevronLeft, ShieldCheck, FolderKanban, RotateCcw, History, Coins, UserRound, Banknote,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { canAccessRoute } from '@/lib/permissions';
import { localeFor } from '@/lib/utils';
import type { Lang } from '@/lib/i18n';
import type { Route } from '@/App';
import ThemeWallpaper from '@/components/ThemeWallpaper';
import NotificationCenter from '@/components/NotificationCenter';
import CashStatusChip from '@/components/CashStatusChip';
import WhatsAppSupport from '@/components/WhatsAppSupport';
import { FullPageSpinner } from '@/components/Spinner';
import Dashboard from '@/pages/Dashboard';

const POS = lazy(() => import('@/pages/POS'));
const Products = lazy(() => import('@/pages/Products'));
const Categories = lazy(() => import('@/pages/Categories'));
const AddProduct = lazy(() => import('@/pages/AddProduct'));
const ProductDetails = lazy(() => import('@/pages/ProductDetails'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const AddStock = lazy(() => import('@/pages/AddStock'));
const RemoveStock = lazy(() => import('@/pages/RemoveStock'));
const StockHistory = lazy(() => import('@/pages/StockHistory'));
const Suppliers = lazy(() => import('@/pages/Suppliers'));
const SupplierLedger = lazy(() => import('@/pages/SupplierLedger'));
const Customers = lazy(() => import('@/pages/Customers'));
const Purchases = lazy(() => import('@/pages/Purchases'));
const SalesHistory = lazy(() => import('@/pages/SalesHistory'));
const CreditSales = lazy(() => import('@/pages/CreditSales'));
const ReturnRefund = lazy(() => import('@/pages/ReturnRefund'));
const Ledger = lazy(() => import('@/pages/Ledger'));
const DebtCollection = lazy(() => import('@/pages/DebtCollection'));
const BarcodePage = lazy(() => import('@/pages/Barcode'));
const ReceiptDesigner = lazy(() => import('@/pages/ReceiptDesigner'));
const PrintReceipt = lazy(() => import('@/pages/PrintReceipt'));
const Reports = lazy(() => import('@/pages/Reports'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const Caisse = lazy(() => import('@/pages/Caisse'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const UserManagement = lazy(() => import('@/pages/UserManagement'));
const ActivityLogs = lazy(() => import('@/pages/ActivityLogs'));
const Backup = lazy(() => import('@/pages/Backup'));
const WorkerReport = lazy(() => import('@/pages/WorkerReport'));

interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
  group: string;
}

interface LayoutProps {
  route: Route;
  routeParam: string | null;
  navigate: (r: Route, param?: string | null) => void;
  onLogout: () => void;
}

export default function Layout({ route, routeParam, navigate, onLogout }: LayoutProps) {
  const { t, lang, setLang, theme, setTheme, currentUser, settings } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: NavItem[] = useMemo(() => {
    const all: NavItem[] = [
      { route: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={20} />, group: 'main' },
      { route: 'myReport', label: t('myActivity'), icon: <UserRound size={20} />, group: 'main' },
      { route: 'workerReport', label: t('workerReports'), icon: <Users size={20} />, group: 'tools' },
      { route: 'pos', label: t('pos'), icon: <ShoppingCart size={20} />, group: 'main' },
      { route: 'salesHistory', label: t('salesHistory'), icon: <History size={20} />, group: 'main' },
      { route: 'products', label: t('products'), icon: <Package size={20} />, group: 'main' },
      { route: 'categories', label: t('categories'), icon: <FolderKanban size={20} />, group: 'main' },
      { route: 'inventory', label: t('inventory'), icon: <Boxes size={20} />, group: 'main' },
      { route: 'purchases', label: t('purchases'), icon: <ShoppingBag size={20} />, group: 'main' },
      { route: 'supplierLedger', label: t('supplierLedger'), icon: <BookOpen size={20} />, group: 'credit' },
      { route: 'suppliers', label: t('suppliers'), icon: <Truck size={20} />, group: 'main' },
      { route: 'customers', label: t('customers'), icon: <Users size={20} />, group: 'main' },
      { route: 'returnRefund', label: t('returnRefund'), icon: <RotateCcw size={20} />, group: 'main' },
      { route: 'creditSales', label: t('creditSales'), icon: <CreditCard size={20} />, group: 'credit' },
      { route: 'ledger', label: t('ledger'), icon: <BookOpen size={20} />, group: 'credit' },
      { route: 'debtCollection', label: t('debtCollection'), icon: <Wallet size={20} />, group: 'credit' },
      { route: 'barcode', label: t('barcode'), icon: <Barcode size={20} />, group: 'tools' },
      { route: 'receiptDesigner', label: t('receiptDesigner'), icon: <Receipt size={20} />, group: 'tools' },
      { route: 'reports', label: t('reports'), icon: <BarChart3 size={20} />, group: 'tools' },
      { route: 'caisse', label: t('caisse'), icon: <Banknote size={20} />, group: 'main' },
      { route: 'expenses', label: t('expenses'), icon: <Coins size={20} />, group: 'tools' },
      { route: 'userManagement', label: t('userManagement'), icon: <UserCog size={20} />, group: 'admin' },
      { route: 'activityLogs', label: t('activityLogs'), icon: <ScrollText size={20} />, group: 'admin' },
      { route: 'backup', label: t('backup'), icon: <DatabaseBackup size={20} />, group: 'admin' },
      { route: 'settings', label: t('settings'), icon: <Settings size={20} />, group: 'admin' },
    ];
    // A user without permission does not even see the nav item; routes gated
    // by a license feature are hidden too when the license lacks the feature.
    return currentUser ? all.filter((i) => canAccessRoute(currentUser, i.route)) : all;
  }, [t, currentUser]);

  const groups: { key: string; label: string }[] = [
    { key: 'main', label: '' },
    { key: 'credit', label: t('groupCredit') },
    { key: 'tools', label: t('groupTools') },
    { key: 'admin', label: t('groupAdmin') },
  ];

  const storeName = lang === 'ar' && settings?.store_name_ar ? settings.store_name_ar : (settings?.store_name || t('appName'));
  const productRoutes = ['products', 'addProduct', 'productDetails'];
  const inventoryRoutes = ['inventory', 'addStock', 'removeStock', 'stockHistory'];

  const SidebarContent = (
    <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-soft overflow-hidden shrink-0">
            {settings?.logo_url ? <img src={settings.logo_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-accent flex items-center justify-center"><Store size={22} /></div>}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-base truncate">{storeName}</p>
            <p className="text-xs text-gray-400 truncate">{t('appTagline')}</p>
          </div>
        </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">{g.label}</p>}
            {navItems.filter((i) => i.group === g.key).map((item) => {
              const active = route === item.route || (productRoutes.includes(route) && item.route === 'products') || (inventoryRoutes.includes(route) && item.route === 'inventory');
              return (
                <div key={item.route} className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={() => { navigate(item.route); setMobileOpen(false); }}>
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' }}>
          <div className="w-9 h-9 rounded-full bg-accent-100 dark:bg-accent-800 flex items-center justify-center text-accent-700 dark:text-accent-200 font-semibold text-sm">
            {currentUser?.full_name?.[0] ?? currentUser?.username?.[0] ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{currentUser?.full_name || currentUser?.username}</p>
            <p className="text-xs text-gray-400 capitalize">{currentUser?.role}</p>
          </div>
          <button onClick={onLogout} className="btn-ghost p-1.5 rounded-lg" title={t('logout')}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );

  if (route === 'printReceipt') {
    return <Suspense fallback={<FullPageSpinner />}><PageRouter route={route} routeParam={routeParam} navigate={navigate} /></Suspense>;
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--bg)]">
      <ThemeWallpaper />
      <aside className={`relative z-10 hidden lg:flex flex-col glass-sidebar border-r transition-all duration-200 ${sidebarOpen ? 'w-64' : 'w-0'}`}>
        {sidebarOpen && SidebarContent}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 glass-sidebar animate-slide-in-right">
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="glass-topbar flex items-center justify-between px-4 lg:px-6 h-16 border-b shrink-0">
          <div className="flex items-center gap-3">
            <button className="lg:hidden btn-ghost p-2 rounded-lg" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <button className="hidden lg:flex btn-ghost p-2 rounded-lg" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <ChevronLeft size={20} className={`transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
            </button>
            <ClockText lang={lang} />
          </div>

          <div className="flex items-center gap-2">
            <CashStatusChip />
            <button onClick={() => setLang(lang === 'en' ? 'ar' : lang === 'ar' ? 'fr' : 'en')} className="btn-ghost px-3 py-2 rounded-lg text-sm font-medium">
              {lang === 'en' ? 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©' : lang === 'ar' ? 'FranÃ§ais' : 'English'}
            </button>
            <NotificationCenter navigate={navigate} />
            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="btn-ghost p-2 rounded-lg">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button onClick={() => setZoom(prev => Math.min(2, Math.max(0.5, prev + 0.25)))} className="btn-ghost p-2 rounded-lg">
              {zoom >= 1.5 ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">

          <Suspense fallback={<FullPageSpinner />}>
            <PageRouter route={route} routeParam={routeParam} navigate={navigate} />
          </Suspense>
        </main>
      </div>

      <WhatsAppSupport />
    </div>
  );
}

function AccessDenied({ navigate }: { navigate: (r: Route, p?: string | null) => void }) {
  const { t } = useApp();
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-error-100 dark:bg-error-900/30 flex items-center justify-center mb-4">
        <ShieldCheck size={30} className="text-error" />
      </div>
      <h2 className="text-xl font-bold">{t('accessDenied')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm">
        {t('accessDeniedDesc')}
      </p>
      <button className="btn-primary mt-6" onClick={() => navigate('dashboard')}>
        <LayoutDashboard size={18} /> {t('backToDashboard')}
      </button>
    </div>
  );
}

function PageRouter({ route, routeParam, navigate }: { route: Route; routeParam: string | null; navigate: (r: Route, p?: string | null) => void }) {
  const { currentUser } = useApp();
  if (currentUser && !canAccessRoute(currentUser, route)) {
    return <AccessDenied navigate={navigate} />;
  }
  switch (route) {
    case 'dashboard': return <Dashboard navigate={navigate} />;
    case 'pos': return <POS navigate={navigate} />;
    case 'products': return <Products navigate={navigate} />;
    case 'categories': return <Categories />;
    case 'addProduct': return <AddProduct navigate={navigate} productId={routeParam} />;
    case 'productDetails': return <ProductDetails navigate={navigate} productId={routeParam} />;
    case 'inventory': return <Inventory navigate={navigate} productId={routeParam} />;
    case 'addStock': return <AddStock navigate={navigate} productId={routeParam} />;
    case 'removeStock': return <RemoveStock navigate={navigate} productId={routeParam} />;
    case 'stockHistory': return <StockHistory navigate={navigate} productId={routeParam} />;
    case 'suppliers': return <Suppliers />;
    case 'supplierLedger': return <SupplierLedger />;
    case 'customers': return <Customers navigate={navigate as (r: Route, p?: string | null) => void} />;
    case 'purchases': return <Purchases />;
    case 'salesHistory': return <SalesHistory />;
    case 'creditSales': return <CreditSales navigate={navigate as (r: Route, p?: string | null) => void} />;
    case 'returnRefund': return <ReturnRefund initialSaleId={routeParam} />;
    case 'ledger': return <Ledger navigate={navigate as (r: Route, p?: string | null) => void} />;
    case 'debtCollection': return <DebtCollection />;
    case 'barcode': return <BarcodePage navigate={navigate} productId={routeParam} />;
    case 'receiptDesigner': return <ReceiptDesigner navigate={navigate} />;
    case 'printReceipt': return <PrintReceipt navigate={navigate} />;
    case 'reports': return <Reports />;
    case 'expenses': return <Expenses />;
    case 'caisse': return <Caisse />;
    case 'settings': return <SettingsPage />;
    case 'userManagement': return <UserManagement navigate={navigate} />;
    case 'myReport': return <WorkerReport navigate={navigate} />;
    case 'workerReport': return <WorkerReport navigate={navigate} userId={routeParam} monitor />;
    case 'activityLogs': return <ActivityLogs />;
    case 'backup': return <Backup />;
    default: return <Dashboard navigate={navigate} />;
  }
}

function ClockText({ lang }: { lang: Lang }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-2 text-sm text-gray-500">
      <ShieldCheck size={16} className="text-success" />
      <span>{now.toLocaleDateString(localeFor(lang), { weekday: 'long', day: '2-digit', month: 'short' })}</span>
      <span className="text-gray-300">|</span>
      <span className="font-medium tabular-nums">{now.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
  );
}
