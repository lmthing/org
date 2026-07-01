/**
 * Form state + data-loading/saving logic for AgentBuilder.
 * Edits agents/<slug>/instruct.md ONLY.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import {
  useSpaceFS,
  useAgent,
  useGlob,
  useUIState,
  P,
  serializeAgentInstruct,
} from '@lmthing/state'
import type { AgentInstruct } from '@lmthing/state'
import { buildSpacePath } from '@lmthing/ui/lib/space-path'

function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled'
}

export function useAgentForm() {
  const params = useParams({ strict: false }) as {
    projectId?: string; spaceId?: string; agentId?: string
  }
  const { projectId, spaceId, agentId } = params
  const navigate = useNavigate()
  const spaceFS = useSpaceFS()

  // ── space resource discovery ──────────────────────────────────────────────
  const tasklistMatches = useGlob(P.globs.allTasklists)
  const functionMatches = useGlob(P.globs.allFunctions)
  const viewComponentMatches = useGlob(P.globs.allViewComponents)
  const formComponentMatches = useGlob(P.globs.allFormComponents)
  const knowledgeIndexMatches = useGlob(P.globs.allKnowledgeIndexes)

  const tasklistNames = useMemo(() => {
    const names = new Set<string>()
    for (const path of tasklistMatches) {
      const parts = path.split('/')
      if (parts.length >= 2) names.add(parts[1])
    }
    return Array.from(names).sort()
  }, [tasklistMatches])

  const functionNames = useMemo(() =>
    functionMatches.map(p => p.split('/').pop()?.replace(/\.ts$/, '') ?? '').filter(Boolean).sort()
  , [functionMatches])

  const componentNames = useMemo(() => {
    const names = new Set<string>()
    for (const p of viewComponentMatches) {
      const n = p.split('/').pop()?.replace(/\.tsx$/, '')
      if (n) names.add(n)
    }
    for (const p of formComponentMatches) {
      // components/form/<Name>.tsx (single-file)
      const n = p.split('/').pop()?.replace(/\.tsx$/, '')
      if (n) names.add(n)
    }
    return Array.from(names).sort()
  }, [viewComponentMatches, formComponentMatches])

  // Option-level: knowledge/<domain>/<field>/<slug>.md (excludes index.md)
  const knowledgeOptionMatches = useGlob(P.globs.allKnowledgeOptions)

  const knowledgeRefs = useMemo(() => {
    // 2-part field-level refs: knowledge/<domain>/<field>/index.md → "domain/field"
    const fieldRefs = knowledgeIndexMatches.map(p => {
      const parts = p.split('/')
      if (parts.length >= 3) return `${parts[1]}/${parts[2]}`
      return null
    }).filter((x): x is string => x !== null)

    // 3-part option-level refs: knowledge/<domain>/<field>/<slug>.md → "domain/field/slug"
    const optionRefs = knowledgeOptionMatches.map(p => {
      const parts = p.split('/')
      // parts: ["knowledge", domain, field, "slug.md"]
      if (parts.length >= 4) {
        const slug = parts[3].replace(/\.md$/, '')
        return `${parts[1]}/${parts[2]}/${slug}`
      }
      return null
    }).filter((x): x is string => x !== null)

    return [...fieldRefs, ...optionRefs].sort()
  }, [knowledgeIndexMatches, knowledgeOptionMatches])

  // ── load existing agent ───────────────────────────────────────────────────
  const agent = useAgent(agentId ?? '')

  // ── draft state ───────────────────────────────────────────────────────────
  const [draftTitle, setDraftTitle] = useUIState('agent-builder.draft-title', '')
  const [draftBody, setDraftBody] = useUIState('agent-builder.draft-body', '')
  const [draftActions, setDraftActions] = useUIState<AgentInstruct['actions']>('agent-builder.draft-actions', [])
  const [draftDefaultAction, setDraftDefaultAction] = useUIState('agent-builder.draft-default-action', '')
  const [draftFunctions, setDraftFunctions] = useUIState<string[]>('agent-builder.draft-functions', [])
  const [draftComponents, setDraftComponents] = useUIState<string[]>('agent-builder.draft-components', [])
  const [draftKnowledge, setDraftKnowledge] = useUIState<string[]>('agent-builder.draft-knowledge', [])
  const [draftCanDelegateTo, setDraftCanDelegateTo] = useUIState<string[]>('agent-builder.draft-candelegateto', [])

  // Sync draft from instruct when agent loads / agentId changes
  const syncKey = `${agentId}::${agent.instruct?.title ?? ''}`
  const lastSyncKey = useRef('')
  useEffect(() => {
    if (lastSyncKey.current === syncKey) return
    lastSyncKey.current = syncKey
    const inst = agent.instruct
    if (agentId && inst) {
      setDraftTitle(inst.title ?? '')
      setDraftBody(inst.body ?? '')
      setDraftActions(inst.actions ?? [])
      setDraftDefaultAction(inst.defaultAction ?? '')
      setDraftFunctions(inst.functions ?? [])
      setDraftComponents(inst.components ?? [])
      setDraftKnowledge(inst.knowledge ?? [])
      setDraftCanDelegateTo(inst.canDelegateTo ?? [])
    } else if (!agentId) {
      setDraftTitle(''); setDraftBody(''); setDraftActions([])
      setDraftDefaultAction(''); setDraftFunctions([]); setDraftComponents([])
      setDraftKnowledge([]); setDraftCanDelegateTo([])
    }
  })

  const spacePath = buildSpacePath(projectId, spaceId)
  const isNew = !agentId
  const isValid = draftTitle.trim().length > 0

  const hasUnsavedChanges = isNew
    ? isValid
    : (
      draftTitle !== (agent.instruct?.title ?? '') ||
      draftBody !== (agent.instruct?.body ?? '') ||
      JSON.stringify(draftActions) !== JSON.stringify(agent.instruct?.actions ?? []) ||
      draftDefaultAction !== (agent.instruct?.defaultAction ?? '') ||
      JSON.stringify(draftFunctions) !== JSON.stringify(agent.instruct?.functions ?? []) ||
      JSON.stringify(draftComponents) !== JSON.stringify(agent.instruct?.components ?? []) ||
      JSON.stringify(draftKnowledge) !== JSON.stringify(agent.instruct?.knowledge ?? []) ||
      JSON.stringify(draftCanDelegateTo) !== JSON.stringify(agent.instruct?.canDelegateTo ?? [])
    )

  const handleSave = useCallback(() => {
    if (!spaceFS || !isValid) return
    const id = agentId || slugify(draftTitle)
    const instruct: AgentInstruct = {
      title: draftTitle.trim(),
      body: draftBody.trim(),
      actions: draftActions,
      defaultAction: draftDefaultAction || undefined,
      functions: draftFunctions,
      components: draftComponents,
      knowledge: draftKnowledge,
      canDelegateTo: draftCanDelegateTo,
    }
    spaceFS.writeFile(P.instruct(id), serializeAgentInstruct(instruct))
    if (!agentId) {
      navigate({ to: `${spacePath}/agent/${encodeURIComponent(id)}` })
    }
  }, [spaceFS, isValid, agentId, draftTitle, draftBody, draftActions, draftDefaultAction, draftFunctions, draftComponents, draftKnowledge, draftCanDelegateTo, spacePath, navigate])

  const handleBack = useCallback(() => {
    navigate({ to: `${spacePath}/agent` })
  }, [navigate, spacePath])

  // Actions helpers
  const addAction = useCallback(() => {
    setDraftActions(prev => [...prev, { id: '', label: '', description: '', tasklist: '' }])
  }, [setDraftActions])

  const updateAction = useCallback((idx: number, updated: AgentInstruct['actions'][number]) => {
    setDraftActions(prev => prev.map((a, i) => i === idx ? updated : a))
  }, [setDraftActions])

  const removeAction = useCallback((idx: number) => {
    setDraftActions(prev => prev.filter((_, i) => i !== idx))
  }, [setDraftActions])

  return {
    isNew,
    isValid,
    hasUnsavedChanges,

    draftTitle,
    setDraftTitle,
    draftBody,
    setDraftBody,
    draftActions,
    draftDefaultAction,
    setDraftDefaultAction,
    draftFunctions,
    setDraftFunctions,
    draftComponents,
    setDraftComponents,
    draftKnowledge,
    setDraftKnowledge,
    draftCanDelegateTo,
    setDraftCanDelegateTo,

    tasklistNames,
    functionNames,
    componentNames,
    knowledgeRefs,

    handleSave,
    handleBack,
    addAction,
    updateAction,
    removeAction,
  }
}

export type UseAgentFormResult = ReturnType<typeof useAgentForm>
