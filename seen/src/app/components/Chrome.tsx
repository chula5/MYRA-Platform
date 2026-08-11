import Link from 'next/link';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`display text-[22px] tracking-tightest ${className}`}>
      SEEN<span className="text-accent">.</span>
    </Link>
  );
}

export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto max-w-page px-6 h-[72px] flex items-center justify-between">
        <div className="flex items-baseline gap-5">
          <Wordmark />
          <span className="hidden sm:inline text-[12px] text-muted tracking-wide">
            See It Through.
          </span>
        </div>
        <div className="flex items-center gap-6">{right}</div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto max-w-page px-6 py-8 flex flex-wrap items-center justify-between gap-4">
        <span className="text-[12px] text-muted">Saved isn&rsquo;t done.</span>
        <div className="flex gap-6">
          <Link href="/voice" className="btn-quiet">
            Voice
          </Link>
          <Link href="/connect" className="btn-quiet">
            Sources
          </Link>
        </div>
      </div>
    </footer>
  );
}
