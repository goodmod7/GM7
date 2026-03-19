'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { getMe, logout, type SessionUser } from '../lib/auth';
import { GorkhLogo } from './brand';
import { Button } from './ui';

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname.startsWith('/dashboard');
  }
  return pathname === href;
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessionUser = await getMe();
        if (active) {
          setUser(sessionUser);
        }
      } catch {
        if (active) {
          setUser(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <div className="site-header__left">
            <Link href="/" aria-label="Go to home">
              <GorkhLogo compact />
            </Link>
            <nav className="site-nav" aria-label="Primary">
              <Link className={`site-nav__link ${isActive(pathname, '/download') ? 'site-nav__link--active' : ''}`} href="/download">
                Download
              </Link>
              {user ? (
                <>
                  <Link className={`site-nav__link ${isActive(pathname, '/dashboard') ? 'site-nav__link--active' : ''}`} href="/dashboard">
                    Dashboard
                  </Link>
                  <Link className={`site-nav__link ${isActive(pathname, '/billing') ? 'site-nav__link--active' : ''}`} href="/billing">
                    Billing
                  </Link>
                </>
              ) : null}
            </nav>
          </div>

          <div className="site-header__right">
            {user ? (
              <>
                <span className="site-nav__link" style={{ letterSpacing: '0.12em' }}>
                  {user.email}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void (async () => {
                      await logout();
                      setUser(null);
                      router.push('/');
                      router.refresh();
                    })();
                  }}
                  aria-label="Logout"
                >
                  <LogOut size={16} />
                </Button>
              </>
            ) : (
              <>
                <Link className="site-nav__link" href="/login">
                  Log In
                </Link>
                <Link href="/register">
                  <span className="button">Initiate</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="site-footer__inner">2026 GORKH. Desktop Intelligence Layer.</div>
      </footer>
    </div>
  );
}
