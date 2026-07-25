import { render } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { SettingsDialog } from './index'

/**
 * The shipped `SettingsDialog`. Replaces the deleted `settings-dialog-styled.test.tsx`, which gated
 * a parallel `styled()` copy nothing imported. See docs/tamagui-idiomatic-migration.md §4/§6.
 */
describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SettingsDialog open={false} onOpenChange={() => {}} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  // NOT tested here: the OPEN dialog. Its tab panels pull in `@lmthing/auth`, which resolves a
  // second copy of React under this vitest config, so any hook in the tree throws "Invalid hook
  // call". That is a test-environment limitation, not a component defect — the open path is
  // exercised by the `Dialog` element's own suite (`elements/overlays/dialog/index.test.tsx`),
  // which covers the surface this component styles. See docs/tamagui-idiomatic-migration.md §6.
})
