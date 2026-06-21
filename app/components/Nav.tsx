'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Optimal', sub: 'A' },
  { href: '/riders', label: 'Riders', sub: 'B' },
  { href: '/stages', label: 'Stages & Data', sub: 'C' },
  { href: '/how', label: 'How it works', sub: 'D' },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-ink-500 bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 sm:px-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="mono text-lg font-bold tracking-tight">
            <span className="j-yellow">D</span>OMESTIQUE
          </span>
          <span className="hidden sm:inline mono text-[10px] text-chalk-500">TOURSPILLET&nbsp;2026</span>
        </Link>
        <nav className="ml-auto flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`mono whitespace-nowrap rounded px-2.5 py-1 text-xs sm:text-sm transition-colors ${
                  active ? 'bg-yellow/15 text-yellow' : 'text-chalk-300 hover:bg-ink-700'
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
