import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { DataProvider, useData } from './data/DataContext';
import { AuthModal } from './components/AuthModal';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastProvider, useToast } from './components/ToastContext';
import { areaPlans, eodPlans } from './data/planData';
import { AreaPlanPage } from './pages/AreaPlanPage';
import { EodPlanPage } from './pages/EodPlanPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { RoutesPage } from './pages/RoutesPage';
import type { PageId } from './types';

function AppFrame() {
  const [page, setPage] = useState<PageId>('routes');
  const [menuOpen, setMenuOpen] = useState(false);
  const { snapshot } = useData();
  const { error, dismissError, promptOpen } = useAuth();
  const { notify } = useToast();

  useEffect(() => {
    // Поки відкрите вікно входу, помилку показує сама модалка.
    if (!error || promptOpen) return;
    notify(error, 'error');
    dismissError();
  }, [error, promptOpen, notify, dismissError]);

  const content = (() => {
    switch (page) {
      case 'facilities':
        return <FacilitiesPage />;
      case 'area-plan':
        return <AreaPlanPage />;
      case 'eod-plan':
        return <EodPlanPage />;
      case 'routes':
      default:
        return <RoutesPage />;
    }
  })();

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onNavigate={setPage}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        counts={{
          routes: snapshot.routes.length,
          facilities: snapshot.facilities.length,
          areaPlans: areaPlans.length,
          eodPlans: eodPlans.length,
        }}
      />
      <main className="main-content">
        <Topbar page={page} onOpenMenu={() => setMenuOpen(true)} />
        {content}
      </main>
      {menuOpen && (
        <button className="mobile-scrim" aria-label="Закрити меню" onClick={() => setMenuOpen(false)} />
      )}
      <AuthModal />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          <AppFrame />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
