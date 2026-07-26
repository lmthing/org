import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import { ChatView } from './ChatView';
import { Sidebar } from './Sidebar';
import { DevPanel } from './DevPanel';
import { ProjectSettings } from './ProjectSettings';
import { Drawer } from '../components/ui/Drawer';
import { cn } from '../lib/cn';
import { getLiveSend } from './live-send';

interface AppShellProps {
  singleSession?: boolean;
}

export function AppShell({ singleSession }: AppShellProps) {
  const devPanelOpen = useStore(s => s.devPanelOpen);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const setDevPanelOpen = useStore(s => s.setDevPanelOpen);
  const setSidebarOpen = useStore(s => s.setSidebarOpen);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeSessionId = useStore(s => s.activeSessionId);
  const mode = useStore(s => s.mode);
  const running = useStore(s => Object.values(s.model.nodes).filter(n => n.status === 'running').length);
  const done = useStore(s => s.done);
  const noteUser = useStore(s => s.noteUserMessage);

  // Post the resume nudge into the ACTIVE chat after an Integrations-tab save (the
  // pod has already been confirmed back by the tab). Show it in the transcript
  // (noteUser) AND hand it to the live session socket so THING continues. The tab
  // only calls this once the socket is open, so the send is never a silent drop.
  const onIntegrationConfigured = React.useCallback((_spaceId: string, message: string) => {
    noteUser(message);
    const send = getLiveSend();
    send?.({ type: 'sendMessage', content: message });
  }, [noteUser]);

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
      height="100%"
    />
  );

  const drawerSidebarContent = (
    <Sidebar
      onProjectSettings={(id, name) => setProjectSettings({ id, name })}
      width="100%"
      height="100%"
      collapsible={false}
    />
  );

  const devPanelContent = (
    <DevPanel
      onClose={() => setDevPanelOpen(false)}
      height="100%"
    />
  );

  return (
    <Prim.Row height="100%" overflow="hidden" backgroundColor="$background">
      {/* Sidebar — docked on desktop, drawer on mobile */}
      {showSidebar && !sidebarAsDrawer && sidebarOpen && (
        <Prim.Box flexShrink={0} height="100%">
          {sidebarContent}
        </Prim.Box>
      )}
      {showSidebar && sidebarAsDrawer && (
        <Drawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          side="left"
          width="16rem"
        >
          {drawerSidebarContent}
        </Drawer>
      )}

      {/* Main: chat */}
      <Prim.Col position="relative" overflow="hidden" flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
        {/* Hamburger for mobile */}
        {showSidebar && sidebarAsDrawer && (
          <Prim.Pressable
            onClick={() => setSidebarOpen(!sidebarOpen)}
            position="absolute" top="$3" left="$3" zIndex={10} width="$8" height="$8" display="flex" alignItems="center" justifyContent="center" color="$muted-foreground" borderRadius="$radius-lg" $md={{ display: "none" }} hoverStyle={{ color: "$foreground", backgroundColor: "$muted" }}
            aria-label="Toggle sidebar"
          >
            ☰
          </Prim.Pressable>
        )}

        {/* No session selected in project mode */}
        {showSidebar && !activeSessionId ? (
          <Prim.Row justifyContent="center" color="$muted-foreground" fontSize="$sm" alignItems="center" flexGrow={1} flexShrink={1} flexBasis="0%" lineHeight="1.25rem">
            {activeProjectId
              ? 'Select or start a chat from the sidebar.'
              : 'Select or create a project to get started.'}
          </Prim.Row>
        ) : (
          <ChatView
            onOpenDevPanel={() => setDevPanelOpen(!devPanelOpen)}
            devPanelOpen={devPanelOpen}
            projectId={activeProjectId}
            singleSession={singleSession}
            flexGrow={1}
            flexShrink={1}
            flexBasis="0%"
            minHeight={0}
          />
        )}
      </Prim.Col>

      {/* DevPanel — docked on desktop, drawer on tablet */}
      {showDevPanel && !devPanelAsDrawer && devPanelContent}
      {showDevPanel && devPanelAsDrawer && (
        <Drawer
          open={devPanelOpen}
          onClose={() => setDevPanelOpen(false)}
          side="right"
          width="24rem"
          title="DevTools"
        >
          <DevPanel onClose={() => setDevPanelOpen(false)} height="100%" />
        </Drawer>
      )}

      {/* Project settings drawer */}
      {projectSettings && (
        <ProjectSettings
          open={true}
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          projectName={projectSettings.name}
          onIntegrationConfigured={onIntegrationConfigured}
        />
      )}
    </Prim.Row>
  );
}
