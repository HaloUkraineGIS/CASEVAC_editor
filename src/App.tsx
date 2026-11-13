import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { DataProvider, useData } from './data/DataContext';
import { Menu } from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { Sidebar } from './components/Sidebar';
import { ToastProvider, useToast } from './components/ToastContext';
import { groupFacilitiesByRegion, filterActiveFacilities } from './lib/facilityRegion';
import { AreaPlanPage } from './pages/AreaPlanPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { RoutesPage } from './pages/RoutesPage';
import type { PageId } from './types';

function AppFrame() {
  const [page, setPage] = useState<PageId>('facilities');
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
      // Сторінка 'eod-plan' («Маршрути CASEVAC CDS») вимкнена і недоступна.
      case 'eod-plan':
        return <FacilitiesPage />;
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
          areaPlans: groupFacilitiesByRegion(
            filterActiveFacilities(snapshot.facilities),
            snapshot.facilitySchema,
          ).length,
        }}
      />
      <main className="main-content">
        <button
          className="mobile-menu-fab"
          onClick={() => setMenuOpen(true)}
          aria-label="Відкрити меню"
          title="Меню"
        >
          <Menu size={20} />
        </button>
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
