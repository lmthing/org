import { render, fireEvent, act } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../theme/tamagui.config'
import { Composer } from './composer'
import type { Directory } from './types'

/**
 * Item 3: the draft must not survive a channel switch.
 *
 * `channels-view.tsx` fixes this by keying its `<Composer>` on the channel/thread id — with no
 * key, React reuses the same component instance across a switch, and its internal `draft` state
 * (`composer.tsx`) comes along with it. Typing in #general and then clicking #random left
 * #general's half-written message sitting in the box, one send away from going to the wrong
 * channel.
 *
 * This harness reproduces the exact wiring the fix relies on — a parent that re-keys `Composer` by
 * the active channel id — rather than testing `Composer` in isolation, since the bug was never in
 * the component itself but in how its caller mounted it.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const DIRECTORY: Directory = { members: [], projects: [] }

function Harness() {
  const [channelId, setChannelId] = React.useState('general')
  return (
    <>
      <button onClick={() => setChannelId('random')}>switch to #random</button>
      <Composer
        key={channelId}
        placeholder={`Message #${channelId}`}
        directory={DIRECTORY}
        meId="me"
        onSend={vi.fn()}
      />
    </>
  )
}

describe('Composer draft — keyed per channel (item 3)', () => {
  it('does not carry a half-written message from one channel into the next', () => {
    const { getByPlaceholderText, getByText } = render(
      <P>
        <Harness />
      </P>,
    )

    const generalBox = getByPlaceholderText('Message #general') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(generalBox, { target: { value: 'this is meant for #general only' } })
    })
    expect(generalBox.value).toBe('this is meant for #general only')

    act(() => {
      fireEvent.click(getByText('switch to #random'))
    })

    // A fresh instance for #random — its box must be empty, not carrying the #general draft.
    const randomBox = getByPlaceholderText('Message #random') as HTMLTextAreaElement
    expect(randomBox).not.toBe(generalBox)
    expect(randomBox.value).toBe('')
  })
})
