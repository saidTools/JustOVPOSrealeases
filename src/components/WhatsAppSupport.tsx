import { useEffect, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { useApp } from '@/context/AppContext';

const CONTACTS = [
  { name: 'Hakim', phone: '0796965952', whatsapp: '0655551844' },
  { name: 'Said', phone: '0541230819', whatsapp: '0541230819' },
];

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

export default function WhatsAppSupport() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="no-print fixed bottom-5 right-5 z-30">
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={t('supportContactsTitle')}
            className="absolute bottom-full right-0 mb-3 w-[19rem] overflow-hidden rounded-2xl text-sm"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              boxShadow: '0 10px 34px -8px rgba(0, 0, 0, 0.28), 0 2px 10px -2px rgba(0, 0, 0, 0.12)',
              WebkitBackdropFilter: 'blur(16px)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#25D366] text-white">
                  <WhatsAppIcon className="h-4 w-4" />
                </span>
                <span className="font-semibold">{t('supportContactsTitle')}</span>
              </div>
              <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg p-1.5" aria-label={t('close')} title={t('close')}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2.5 p-3">
              {CONTACTS.map((c) => (
                <div key={c.name} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="mb-2 font-semibold">{c.name}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <Phone size={14} className="shrink-0" style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{t('contactPhone')}:</span>
                      <span dir="ltr" className="tabular-nums font-medium">{c.phone}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <WhatsAppIcon className="h-3.5 w-3.5 shrink-0 text-[#25D366]" />
                      <span style={{ color: 'var(--text-secondary)' }}>{t('contactWhatsapp')}:</span>
                      <span dir="ltr" className="tabular-nums font-medium">{c.whatsapp}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        onClick={() => setOpen(!open)}
        aria-label={t('whatsappTooltip')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[#25D366] text-white shadow-soft transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <WhatsAppIcon className="h-6 w-6" />
      </button>
    </div>
  );
}