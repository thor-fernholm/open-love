import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ContentEditorPage } from './pages/ContentEditorPage';
import { ProjectPage } from './pages/ProjectPage';

const COLLAPSED_KEY = 'openlove.sidebarCollapsed';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function App() {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const [projectListVersion, setProjectListVersion] = useState(0);
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
    <div className="flex h-screen bg-canvas">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        refreshKey={projectListVersion}
      />
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

export default App;
