/**
 * AgentBuilder - New spec.
 * Edits agents/<slug>/instruct.md ONLY.
 * Fields: title, body, actions[], defaultAction, functions[], components[], knowledge[], canDelegateTo[]
 */
import '@lmthing/css/components/agent/builder/index.css'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { AgentHeader } from '../agent-header'
import { useAgentForm } from './use-agent-form'
import { SystemPromptPanel } from './system-prompt-panel'
import { ActionsSection } from './actions-section'
import { DefaultActionPanel } from './default-action-panel'
import { MultiSelectField } from './multi-select-field'
import { CanDelegateToField } from './can-delegate-to-field'

export function AgentBuilder() {
  const form = useAgentForm()

  return (
    <div className="agent-builder">
      <AgentHeader
        title={form.draftTitle}
        isNew={form.isNew}
        hasUnsavedChanges={form.hasUnsavedChanges}
        isValid={form.isValid}
        onTitleChange={form.setDraftTitle}
        onSave={form.handleSave}
        onBack={form.handleBack}
      />

      <div className="agent-builder__content">
        <main className="agent-builder__main">
          <div className="agent-builder__main-inner">
            <Stack gap="lg">

              <SystemPromptPanel body={form.draftBody} onChange={form.setDraftBody} />

              <ActionsSection
                actions={form.draftActions}
                tasklistNames={form.tasklistNames}
                onAdd={form.addAction}
                onUpdate={form.updateAction}
                onRemove={form.removeAction}
              />

              {form.draftActions.length > 0 && (
                <DefaultActionPanel
                  actions={form.draftActions}
                  value={form.draftDefaultAction}
                  onChange={form.setDraftDefaultAction}
                />
              )}

              <MultiSelectField
                label="Knowledge"
                available={form.knowledgeRefs}
                selected={form.draftKnowledge}
                onChange={form.setDraftKnowledge}
              />

              <MultiSelectField
                label="Functions"
                available={form.functionNames}
                selected={form.draftFunctions}
                onChange={form.setDraftFunctions}
              />

              <MultiSelectField
                label="Components"
                available={form.componentNames}
                selected={form.draftComponents}
                onChange={form.setDraftComponents}
              />

              <CanDelegateToField refs={form.draftCanDelegateTo} onChange={form.setDraftCanDelegateTo} />

            </Stack>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AgentBuilder
