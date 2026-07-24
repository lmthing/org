import * as Prim from '../elements/primitives/index.js';

export type BootStage = 'booting' | 'connecting' | 'authenticating' | 'running' | 'error'

export interface BootProgressProps {
  tier: 'webcontainer' | 'flyio'
  stage: BootStage
}

const webcontainerSteps = [
  { key: 'booting', label: 'Starting WebContainer' },
  { key: 'running', label: 'Runtime ready' },
]

const flyioSteps = [
  { key: 'connecting', label: 'Connecting to Fly.io node' },
  { key: 'authenticating', label: 'Authenticating' },
  { key: 'running', label: 'Runtime ready' },
]

function getStepState(stepKey: string, currentStage: BootStage, steps: { key: string }[]): 'done' | 'active' | 'pending' {
  const currentIdx = steps.findIndex((s) => s.key === currentStage)
  const stepIdx = steps.findIndex((s) => s.key === stepKey)
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return 'active'
  return 'pending'
}

// .computer-boot-progress__step--done / --active color modifiers → conditional prop
// (boot-progress.styled.tsx proof `state` variant). `pending` has no modifier and inherits the
// steps container color.
const STEP_COLOR: Record<'done' | 'active' | 'pending', string | undefined> = {
  done: '$success',
  active: '$foreground',
  pending: undefined,
}

function BootProgress({ tier, stage }: BootProgressProps) {
  if (stage === 'running') return null

  const steps = tier === 'flyio' ? flyioSteps : webcontainerSteps
  const label = tier === 'flyio'
    ? 'Connecting to your Computer node...'
    : 'Starting browser runtime...'

  return (
    <Prim.Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap="$4"
      padding="$8"
      height="100%"
      minHeight={300}
    >
      <Prim.Box
        width="$8"
        height="$8"
        borderWidth={2}
        borderColor="color-mix(in srgb, var(--muted-foreground) 30%, transparent)"
        borderTopColor="$primary"
        borderRadius="$radius-full"
        className="animate-spin"
      />
      <Prim.Text fontSize="$sm" fontWeight="$medium" color="$muted-foreground">{label}</Prim.Text>
      <Prim.Box
        display="flex"
        flexDirection="column"
        gap="$1"
        fontSize="$xs"
        color="color-mix(in srgb, var(--muted-foreground) 60%, transparent)"
      >
        {steps.map((step) => {
          const state = getStepState(step.key, stage, steps)
          return (
            <Prim.Text
              key={step.key}
              display="flex"
              alignItems="center"
              gap="$2"
              color={STEP_COLOR[state]}
            >
              {state === 'done' ? '\u2713' : state === 'active' ? '\u25CB' : '\u00B7'} {step.label}
            </Prim.Text>
          )
        })}
      </Prim.Box>
    </Prim.Box>
  )
}

export { BootProgress }
