/**
 * StudioProjectView — the `/studio/$projectId` landing (no space selected yet).
 *
 * Renders the shared {@link StudioAppSidebar} (project dropdown + collapsible
 * spaces) plus a welcome/overview in the main area prompting the user to pick a
 * space. Replaces the former project/space grid landings.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { SPLIT_PANE_BASE, SPLIT_PANE_PRIMARY } from '../../../elements/layouts/split-pane/index.js'
import { PAGE_BODY } from '../../../elements/layouts/page/index.js'
import { useProject } from '@lmthing/state'
import { StudioAppSidebar } from '../studio-app-sidebar'

export function StudioProjectView() {
  const { spaces, isLoadingSpaces } = useProject()

  return (
    <Prim.Box {...SPLIT_PANE_BASE} height="100vh">
      <StudioAppSidebar className="shrink-0" />
      <Prim.Box {...SPLIT_PANE_PRIMARY}>
        <Prim.Box {...PAGE_BODY} display="flex" alignItems="center" justifyContent="center">
          <Prim.Box textAlign="center" opacity={0.5}>
            <Prim.Text as="p" fontSize="$lg" fontWeight="$semibold" marginBottom="$2">Select a space to begin</Prim.Text>
            <Prim.Text as="p" fontSize="$sm">
              {isLoadingSpaces
                ? 'Loading spaces…'
                : spaces.length > 0
                  ? `${spaces.length} space${spaces.length === 1 ? '' : 's'} in this project`
                  : 'No spaces yet — create one from the Spaces section.'}
            </Prim.Text>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

export { StudioProjectView as default }
