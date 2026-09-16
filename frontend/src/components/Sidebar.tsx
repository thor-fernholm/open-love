import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { deleteProject, listProjects, type ProjectSummary } from '../lib/projects';
import { SettingsModal } from './SettingsModal';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Bump to force a re-fetch, e.g. right after a project is created or renamed. */
  refreshKey: number;
}

export function Sidebar({ collapsed, onToggleCollapsed, refreshKey }: SidebarProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        // Sidebar is a convenience list - a failed fetch just leaves it
        // showing whatever it last had (or empty on first load).
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function handleDelete(e: React.MouseEvent, project: ProjectSummary) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${project.name}"? This can't be undone.`)) {
      return;
    }
    try {
      await deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (location.pathname.startsWith(`/projects/${project.id}`)) {
        navigate('/');
      }
    } catch {
      // Best-effort - the list just won't reflect it; not the primary
      // error surface for this destructive action.
    }
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-14 flex-shrink-0 flex-col items-center gap-2 border-r border-hairline bg-sidebar py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="rounded-full p-2 text-muted transition hover:bg-sidebar-elevated hover:text-ink"
        >
          <ChevronIcon direction="right" />
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Build options"
          aria-label="Build options"
          className="mt-auto rounded-full p-2 text-muted transition hover:bg-sidebar-elevated hover:text-ink"
        >
          <GearIcon />
        </button>
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col border-r border-hairline bg-sidebar">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="font-display text-lg tracking-tight text-ink">
          Open-Love
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="rounded-full p-1.5 text-muted transition hover:bg-sidebar-elevated hover:text-ink"
        >
          <ChevronIcon direction="left" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate('/')}
        className="mx-3 mb-3 flex items-center justify-center gap-1.5 rounded-sm bg-primary px-3 py-2 text-sm font-medium text-on-primary shadow-button-inset transition hover:opacity-80"
      >
        <span className="text-base leading-none">+</span> New project
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {projects.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted">
            No projects yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <li key={project.id} className="group flex items-center">
                <NavLink
                  to={`/projects/${project.id}`}
                  title={project.name}
                  className={({ isActive }) =>
                    `block flex-1 truncate rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-sidebar-elevated text-ink'
                        : 'text-muted hover:bg-sidebar-elevated hover:text-ink'
                    }`
                  }
                >
                  {project.name}
                </NavLink>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, project)}
                  aria-label={`Delete ${project.name}`}
                  title="Delete project"
                  className="mr-1 flex-shrink-0 rounded p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-error"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="border-t border-hairline p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-sidebar-elevated hover:text-ink"
        >
          <GearIcon /> Build options
        </button>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4"
    >
      <path
        d={direction === 'left' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path
        d="M10 2.5v2M10 15.5v2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M2.5 10h2M15.5 10h2M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <path
        d="M4.5 5.5h11M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6 5.5v9.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
