import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ContentEditorPage } from './pages/ContentEditorPage';
import { ProjectPage } from './pages/ProjectPage';

const COLLAPSED_KEY = 'openlove.sidebarCollapsed';
// Tailwind's default `md` breakpoint (768px) - kept in sync with the
// `md:` classes used throughout this file for the drawer/static split.
const MOBILE_QUERY = '(max-width: 767px)';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the viewport is currently below the `md` breakpoint - used so
 *  the mobile drawer always shows the sidebar expanded (a nav drawer that
 *  opens to a bare icon rail isn't useful) regardless of the desktop-only
 *  collapsed/expanded preference, without rendering two separate Sidebar
 *  instances. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return isMobile;
}

function App() {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const [projectListVersion, setProjectListVersion] = useState(0);
  // Only meaningful below the `md` breakpoint - the sidebar is an
  // off-canvas drawer there instead of the desktop's persistent
  // collapsed/expanded column, so it starts closed rather than sharing
  // `collapsed`'s persisted desktop state.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Per-viewer convenience only - fine if it doesn't stick.
      }
      return next;
    });
  }

  function refreshProjectList() {
    setProjectListVersion((v) => v + 1);
  }

  return (
    <div className="flex h-screen flex-col bg-canvas md:flex-row">
      {/* Mobile-only top bar - the sidebar itself is an off-canvas drawer
          below `md` (see the wrapper below), so this is the only way to
          reach it on a phone-width screen. Hidden entirely at `md` and up,
          where the sidebar is always visible as its own column. */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-hairline bg-sidebar px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open menu"
          className="rounded-full p-1.5 text-muted transition hover:bg-sidebar-elevated hover:text-ink"
        >
          <HamburgerIcon />
        </button>
        <span className="font-display text-lg tracking-tight text-ink">Open-Love</span>
      </div>

      {/* Backdrop - only rendered (and only intercepts clicks) while the
          mobile drawer is open; closing it here mirrors tapping outside any
          other overlay in the app. */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/30 md:hidden"
        />
      )}

      {/* Below `md`: a fixed off-canvas drawer, slid in/out with a
          transform so it's always mounted (no layout shift) and just
          toggles visibility. At `md` and up: back to a normal static
          column, and the transform/fixed positioning is switched off -
          today's unchanged desktop behavior. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 h-full transform transition-transform duration-200 md:static md:z-auto md:h-auto md:translate-x-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          collapsed={isMobile ? false : collapsed}
          onToggleCollapsed={toggleCollapsed}
          refreshKey={projectListVersion}
          onNavigate={() => setMobileSidebarOpen(false)}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          {/* Keyed by path so navigating between projects (or to/from the
              id-less "new project" state) remounts ProjectPage with fresh
              state, rather than reusing an instance across unrelated projects. */}
          <Route
            path="/"
            element={
              <ProjectPage key="new" onProjectsChanged={refreshProjectList} />
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProjectPage
                key={location.pathname}
                onProjectsChanged={refreshProjectList}
              />
            }
          />
          <Route
            path="/projects/:id/content"
            element={<ContentEditorPage key={location.pathname} />}
          />
        </Routes>
      </main>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5"
    >
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  );
}

export default App;
