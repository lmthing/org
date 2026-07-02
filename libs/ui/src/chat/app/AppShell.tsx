import React from 'react';
import { useStore } from '../store/store.js';
import { ChatView } from './ChatView.js';
import { Sidebar } from './Sidebar.js';
import { DevPanel } from './DevPanel.js';
import { ProjectSettings } from './ProjectSettings.js';
import { Drawer } from '../components/ui/Drawer.js';
import { cn } from '../lib/cn.js';

interface AppShellProps {
  singleSession?: boolean;
  /** Optional node rendered beneath the composer input (e.g. budget windows). */
  composerFooter?: React.ReactNode;
}

export function AppShell({ singleSession, composerFooter }: AppShellProps) {
  const devPanelOpen = useStore(s => s.devPanelOpen);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const setDevPanelOpen = useStore(s => s.setDevPanelOpen);
  const setSidebarOpen = useStore(s => s.setSidebarOpen);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeSessionId = useStore(s => s.activeSessionId);
  const mode = useStore(s => s.mode);
  const running = useStore(s => Object.values(s.model.nodes).filter(n => n.status === 'running').length);
  const done = useStore(s => s.done);

  const [projectSettings, setProjectSettings] = React.useState<{ id: string; name: string } | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);
  const [isTablet, setIsTablet] = React.useState(false);

  // Check for ?inspect=1 on load
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('inspect') === '1') setDevPanelOpen(true);
  }, [setDevPanelOpen]);

  // Responsive breakpoints
  React.useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth < 1024);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Document title
  React.useEffect(() => {
    document.title = mode === 'replay'
      ? '⏵ replay · THING'
      : running > 0
      ? `⟳ ${running} running · THING`
      : done
      ? '✓ done · THING'
      : 'THING';
  }, [running, done, mode]);

  // Alt+I shortcut
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'i') { e.preventDefault(); setDevPanelOpen(!devPanelOpen); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [devPanelOpen, setDevPanelOpen]);

  const showSidebar = !singleSession;
  const showDevPanel = devPanelOpen;

  // On mobile, sidebar is always a drawer
  const sidebarAsDrawer = isMobile;
  // On tablet, devpanel is always a drawer
  const devPanelAsDrawer = isTablet;

  // Docked sidebar owns its own width (collapses to a slim rail via its header
  // toggle). In the mobile drawer we fill the drawer width and hide the toggle.
  const sidebarContent = (
    <Sidebar
      onProjectSettings={(id, name) => setProjectSettings({ id, name })}
      className="h-full"
    />
  );

  const drawerSidebarContent = (
    <Sidebar
      onProjectSettings={(id, name) => setProjectSettings({ id, name })}
      className="w-full h-full"
      collapsible={false}
    />
  );

  const devPanelContent = (
    <DevPanel
      onClose={() => setDevPanelOpen(false)}
      className="h-full"
    />
  );

  return (
    <div className="h-full flex overflow-hidden bg-background">
      {/* Sidebar — docked on desktop, drawer on mobile */}
      {showSidebar && !sidebarAsDrawer && sidebarOpen && (
        <div className="shrink-0 h-full">
          {sidebarContent}
        </div>
      )}
      {showSidebar && sidebarAsDrawer && (
        <Drawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          side="left"
          width="w-64"
        >
          {drawerSidebarContent}
        </Drawer>
      )}

      {/* Main: chat */}
      <div className="flex-1 min-w-0 relative flex flex-col overflow-hidden">
        {/* Hamburger for mobile */}
        {showSidebar && sidebarAsDrawer && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden absolute top-3 left-3 z-10 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
        )}

        {/* No session selected in project mode */}
        {showSidebar && !activeSessionId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            {activeProjectId
              ? 'Select or start a chat from the sidebar.'
              : 'Select or create a project to get started.'}
          </div>
        ) : (
          <ChatView
            onOpenDevPanel={() => setDevPanelOpen(!devPanelOpen)}
            devPanelOpen={devPanelOpen}
            projectId={activeProjectId}
            singleSession={singleSession}
            composerFooter={composerFooter}
            className="flex-1 min-h-0"
          />
        )}
      </div>

      {/* DevPanel — docked on desktop, drawer on tablet */}
      {showDevPanel && !devPanelAsDrawer && devPanelContent}
      {showDevPanel && devPanelAsDrawer && (
        <Drawer
          open={devPanelOpen}
          onClose={() => setDevPanelOpen(false)}
          side="right"
          width="w-96"
          title="DevTools"
        >
          <DevPanel onClose={() => setDevPanelOpen(false)} className="h-full" />
        </Drawer>
      )}

      {/* Project settings drawer */}
      {projectSettings && (
        <ProjectSettings
          open={true}
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          projectName={projectSettings.name}
        />
      )}
    </div>
  );
}
