/**
 * Resolves the THING model id and whether any provider API key is present
 * in the pod's env. Both are read once (env doesn't change at runtime).
 */
import { useMemo } from 'react'
import { checkHasEnv, resolveModelId } from './utils'
import type { ThingModelId } from './types'

export function useThingApiConfig(): { hasEnv: boolean; model: ThingModelId } {
  const hasEnv = useMemo(() => checkHasEnv(), [])
  const model = useMemo(() => resolveModelId(), [])
  return { hasEnv, model }
}
