'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CyclistMark } from './graphics';

const TABS = [
  { href: '/', label: 'Optimal' },
  { href: '/riders', label: 'Riders' },
  { href: '/stages', label: 'Stages & Data' },
  { href: '/how', label: 'How it works' },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-500/60 bg-ink-900/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <span className="text-gold transition-transform group-hover:-translate-y-0.5">
            <CyclistMark size={26} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-chalk-100">Domestique</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-chalk-500 sm:block">Tourspillet 2026</span>
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-0.5 rounded-xl border border-ink-500/50 bg-ink-800/60 p-1">
          {TABS.map((t) => {
            const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? 'bg-ink-600 text-chalk-100 shadow-sm' : 'text-chalk-300 hover:text-chalk-100'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
