/** save-workflow-modal.styled.tsx — P2 conversion of the `.save-workflow-modal` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className modal. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.save-workflow-modal__dialog` — max-width 28rem (Tailwind max-w-md, no token → literal). */
export const SaveWorkflowModalDialogFrame = styled(View, {
  name: 'SaveWorkflowModalDialog',
  maxWidth: '28rem',
})

/** `.save-workflow-modal__body` — padding 1.5rem. */
export const SaveWorkflowModalBodyFrame = styled(View, {
  name: 'SaveWorkflowModalBody',
  padding: '$6',
})

/** `.save-workflow-modal__footer` — flex, justify-end, gap 0.75rem. */
export const SaveWorkflowModalFooterFrame = styled(View, {
  name: 'SaveWorkflowModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
})

export interface StyledSaveWorkflowModalProps extends React.ComponentProps<'div'> {}

const Frame = SaveWorkflowModalDialogFrame as unknown as React.ComponentType<any>
export function StyledSaveWorkflowModal({ ...props }: StyledSaveWorkflowModalProps) {
  return <Frame {...props} />
}
