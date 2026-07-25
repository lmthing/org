import * as Prim from '../../../elements/primitives/index';
/**
 * Chat pane header: current conversation title plus a status dot reflecting
 * error / working / ready / needs-config state.
 */

export interface ThingChatHeaderProps {
  title: string
  isWorking: boolean
  hasError: boolean
  hasEnv: boolean
}

export function ThingChatHeader({ title, isWorking, hasError, hasEnv }: ThingChatHeaderProps) {
  const dotColor = hasError ? '$destructive'
    : isWorking ? '$agent'
    : hasEnv ? '$knowledge'
    : '$brand-2'

  return (
    <Prim.Box
      paddingVertical="$3"
      paddingHorizontal="$4"
      borderBottomWidth={1}
      borderBottomColor="$border"
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      <Prim.Text fontSize="$sm" fontWeight="$medium">
        {title}
      </Prim.Text>
      <Prim.Box display="flex" alignItems="center" gap="$2">
        {isWorking && (
          <Prim.Text fontSize="$xs" opacity={0.6}>Processing...</Prim.Text>
        )}
        <Prim.Text
          width={8}
          height={8}
          borderRadius="$radius-full"
          display="inline-block"
          backgroundColor={dotColor}
        />
      </Prim.Box>
    </Prim.Box>
  )
}
