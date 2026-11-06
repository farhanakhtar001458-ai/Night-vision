import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarContent, MobileSidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 border-r border-white/[0.06] bg-ink-950/60 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
        <footer className="border-t border-white/[0.05] px-6 py-4 text-[11px] text-slate-500">
          DroidLink X · owner-scoped device mesh · all remote sessions require an authenticated, revocable connection.
        </footer>
      </div>
    </div>
  );
}
