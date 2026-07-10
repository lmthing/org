/**
 * StudioProjectView — the `/studio/$projectId` landing (no space selected yet).
 *
 * Renders the shared {@link StudioAppSidebar} (project dropdown + collapsible
 * spaces) plus a welcome/overview in the main area prompting the user to pick a
 * space. Replaces the former project/space grid landings.
 */
import '@lmthing/css/elements/layouts/split-pane/index.css'
import '@lmthing/css/elements/layouts/page/index.css'
import '@lmthing/css/elements/content/panel/index.css'
import '@lmthing/css/components/shell/studio-shell/index.css'
import { useProject } from '@lmthing/state'
import { StudioAppSidebar } from '../studio-app-sidebar'
import { InstallPanel } from '../../integrations/InstallPanel'

export function StudioProjectView() {
  const { projectId, spaces, isLoadingSpaces } = useProject()

  return (
    <div className="split-pane studio-shell">
      <StudioAppSidebar className="shrink-0" />
      <div className="split-pane__primary">
        <div className="page__body studio-shell__empty">
          <div className="studio-shell__empty-content">
            <p className="studio-shell__empty-title">Select a space to begin</p>
            <p className="studio-shell__empty-subtitle">
              {isLoadingSpaces
                ? 'Loading spaces…'
                : spaces.length > 0
                  ? `${spaces.length} space${spaces.length === 1 ? '' : 's'} in this project`
                  : 'No spaces yet — create one from the Spaces section.'}
            </p>
          </div>
        </div>
        {projectId && (
          <div className="page__body" style={{ paddingTop: 0 }}>
            <InstallPanel projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  )
}

export { StudioProjectView as default }
