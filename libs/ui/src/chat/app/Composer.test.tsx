import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { useStore } from '../store/store'
import { Composer } from './Composer'

/**
 * The composer's one-line ⇄ stacked arrangement.
 *
 * The bug these pin is a RECONCILIATION bug, not a styling one, which is why it is asserted on the
 * DOM node's IDENTITY rather than on anything you can see. The two arrangements were written as
 * two branches — `<>{field}<Row/></>` against `<Row>…{field}…</Row>` — which put the field under a
 * different parent in each. React reconciles by position and a `key` only disambiguates siblings,
 * so crossing that boundary remounts the input however it is keyed. On web that silently loses the
 * caret; on a phone the native `TextInput` is destroyed and THE KEYBOARD CLOSES, mid-sentence,
 * the moment a message grows past one line.
 *
 * jsdom can prove this because the reconciler is the same on both targets — a parent change
 * remounts everywhere. What jsdom cannot see is the consequence (there is no keyboard), so the
 * assertion is the cause: same element object before and after.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * `scrollHeight` is how the web half measures wrapped text, and jsdom lays nothing out — it is a
 * hard 0 for every element. Driving it directly is the only way to reach the stacked arrangement
 * here, and it is exactly what a browser would report.
 */
let scrollHeight = 20
const originalScrollHeight = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollHeight',
)

describe('Composer — growing past one line', () => {
  beforeEach(() => {
    scrollHeight = 20
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
  })
  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    }
    vi.unstubAllGlobals()
  })

  /** Type `value`, reporting `height` as the content height a browser would have measured. */
  const type = (field: HTMLTextAreaElement, value: string, height: number) => {
    scrollHeight = height
    act(() => {
      fireEvent.change(field, { target: { value } })
    })
  }

  /**
   * ONE_LINE and TWO_LINES are deliberately not the numbers a web textarea reports. The composer
   * learns the height of one line from the measurements themselves, so a suite that fed it the
   * web's own figures would only prove it against the target that never had the problem — an
   * Android `TextInput` reports its own padding on top and can exceed the old fixed 28px threshold
   * with a single character in the box.
   */
  const ONE_LINE = 33
  const TWO_LINES = 66

  /** Mount, and let the composer see one line before anything wraps — as a real session does. */
  const mount = () => {
    const view = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    )
    const field = view.container.querySelector('textarea')!
    expect(field).toBeTruthy()
    type(field, 'a', ONE_LINE)
    return { ...view, field }
  }

  const sendButton = (container: HTMLElement) =>
    container.querySelector('[aria-label="Send message"]')!

  it('keeps the SAME input element when the message wraps', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)

    // It really did stack — otherwise this asserts nothing.
    expect(field.parentElement?.contains(sendButton(container))).toBe(false)
    // And it is the same object, not merely an element that looks the same. A remount would put a
    // NEW textarea here, which is the keyboard dismissal expressed in the only terms jsdom has.
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('keeps the SAME input element across a wrap and back to empty', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)
    // Emptying is the one transition that unstacks — the second remount the old structure caused,
    // and the one a user hits every time they send.
    type(field, '', ONE_LINE)

    expect(field.parentElement?.contains(sendButton(container))).toBe(true)
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('does not stack on the first keystroke, whatever one line happens to measure', () => {
    const { container, field } = mount()

    // Stacked moves the buttons to a second row, so the row holding the field would no longer hold
    // the send button. One line: they are siblings under one parent.
    expect(field.parentElement?.contains(sendButton(container))).toBe(true)
  })

  it('moves the controls below the field once it really has wrapped', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)

    expect(field.parentElement?.contains(sendButton(container))).toBe(false)
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('collapses back to one line after sending', () => {
    // The sibling of the device bug, on the side jsdom can reach.
    //
    // On a phone the composer stayed stacked with an EMPTY box after every send: the baseline had
    // been learned from a freshly mounted field's `minHeight` clamp — lower than what an empty box
    // settles at — so the empty composer measured as "wrapped" and re-stacked itself the instant
    // the send cleared it. That exact sequence cannot be reproduced here, because the web half
    // measures only in `adjustHeight`, called only from the change handler, so nothing re-measures
    // an emptied box on web at all. The device run is what verified that fix.
    //
    // What this pins is the web-reachable claim: a send returns the composer to one line.
    //
    // CLAMP is what a freshly mounted field reports (`minHeight`), SETTLED is what the same EMPTY
    // field reports once laid out, and SETTLED > CLAMP * 1.5 — the relationship that made a
    // smallest-measurement baseline judge an empty box as wrapped.
    const CLAMP = 24
    const SETTLED = 38
    const WRAPPED = 76

    const sent: string[] = []
    const view = render(
      <P>
        <Composer onSend={(text) => sent.push(text)} />
      </P>,
    )
    const field = view.container.querySelector('textarea')!
    type(field, 'a', CLAMP)
    type(field, 'a message long enough to occupy two full lines of the composer', WRAPPED)
    expect(field.parentElement?.contains(sendButton(view.container))).toBe(false)

    act(() => {
      fireEvent.click(sendButton(view.container))
    })
    type(field, '', SETTLED)

    expect(sent).toEqual(['a message long enough to occupy two full lines of the composer'])
    expect(field.parentElement?.contains(sendButton(view.container))).toBe(true)
    expect(view.container.querySelector('textarea')).toBe(field)
  })
})

/**
 * Touch target sizing. `$7` (28px) is under the 44px minimum on a phone, where these buttons are
 * the only pointer this composer has — no hover to widen the effective hit area the way a mouse
 * cursor's precision does. Base (mobile-first) styling now asks for `$11` (44px); `$md` shrinks it
 * back to the original `$7` once a mouse is likely. Asserted on the emitted atomic class, which
 * carries the token name verbatim (`_width-c-size-11`, matching the Drawer suite's approach).
 */
describe('Composer — touch target sizing', () => {
  it('sizes the attach/mic/send controls at the mobile ($11/44px) token by default', () => {
    const { container } = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    )
    const attach = container.querySelector('[title="Add an image, audio, or file to your message"]')!
    const mic = container.querySelector('[data-testid="mic-button"]')!
    const send = container.querySelector('[aria-label="Send message"]')!
    for (const el of [attach, mic, send]) {
      expect(el.className).toMatch(/_width-c-size-11\b/)
      expect(el.className).toMatch(/_height-c-size-11\b/)
    }
  })
})

/**
 * The `@` completion dropdown used to be selectable only via `onMouseDown` (and highlighted only
 * via `onMouseEnter`) — both mouse-only, so on touch the dropdown was reachable by keyboard alone.
 * `onClick` (which `nativeSafeProps` maps to `onPress` on native) now selects a completion, the
 * same primitive every other control in this file already used.
 */
/**
 * Draft persistence. `text` used to be plain `useState` with nothing durable behind it — an
 * accidental reload, a crash, or a phone killing the tab lost whatever was being written. Now
 * backed by `platform/storage` (jsdom's `localStorage` here), keyed per session so a remount for
 * one session never restores — or, worse, silently sends into — a DIFFERENT session's draft.
 * `ChatView` already remounts `Composer` on a session switch (`ChatView.test.tsx`); these tests
 * cover what a fresh mount does with what a previous one left behind.
 */
describe('Composer — draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ activeSessionId: 's-draft' });
  });

  /** The save is debounced (`DRAFT_SAVE_DEBOUNCE_MS`) — this file has no fake timers elsewhere, so
   *  wait past it for real rather than introducing a second timer strategy into one suite. */
  const waitPastDebounce = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });

  it('restores an unsent draft for this session on a fresh mount', async () => {
    const first = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    );
    const field1 = first.container.querySelector('textarea')! as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(field1, { target: { value: 'an unsent draft' } });
    });
    await waitPastDebounce();
    first.unmount();

    const second = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    );
    // The restore itself is async (`storage.getItem`) — poll rather than assume one microtask.
    await waitFor(() => {
      const field2 = second.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(field2.value).toBe('an unsent draft');
    });
  });

  it('does not leak a draft into a DIFFERENT session', async () => {
    const first = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    );
    const field1 = first.container.querySelector('textarea')! as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(field1, { target: { value: "session one's draft" } });
    });
    await waitPastDebounce();
    first.unmount();

    useStore.setState({ activeSessionId: 'a-different-session' });
    const second = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    );
    // Give the (empty) restore a moment to resolve, then confirm it stayed empty — it must not
    // find anything under the OLD session's key.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const field2 = second.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(field2.value).toBe('');
  });

  it('clears the stored draft immediately once the message is sent', () => {
    const sent: string[] = [];
    const view = render(
      <P>
        <Composer onSend={(t) => sent.push(t)} />
      </P>,
    );
    const field = view.container.querySelector('textarea')! as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(field, { target: { value: 'go now' } });
    });
    act(() => {
      fireEvent.click(view.container.querySelector('[aria-label="Send message"]')!);
    });
    expect(sent).toEqual(['go now']);
    // No need to wait out the debounce — a send clears the draft synchronously (`handleSend`),
    // precisely so a reload inside that window cannot resurrect an already-sent message.
    expect(localStorage.getItem('chat.composer-draft.s-draft')).toBeNull();
  });
});

/**
 * Edit-and-resend, the composer half. `Message.tsx`'s `EditButton` hands the block off via
 * `startEditMessage`; these cover what `Composer` does with it — reopen the text, and on resend
 * truncate the local transcript at that block so a corrected question is never followed by the
 * OLD answer (see the comment in `Composer.handleSend`).
 */
describe('Composer — edit-and-resend', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ activeSessionId: 's-edit', editDraft: null });
  });

  it('reopens the edited message in the field and consumes editDraft', async () => {
    const view = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    );
    act(() => {
      useStore.getState().startEditMessage('u1', 'the original question');
    });
    await waitFor(() => {
      const field = view.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(field.value).toBe('the original question');
    });
    expect(useStore.getState().editDraft).toBeNull();
  });

  it('truncates the local transcript at the edited block on resend', async () => {
    useStore.setState({
      model: {
        nodes: {},
        rootId: 'n1',
        blocks: [
          { id: 'u1', ts: 0, nodeId: 'n1', type: 'user', content: 'old question' },
          { id: 'd1', ts: 0, nodeId: 'n1', type: 'display', descriptor: 'stale answer' },
        ],
        rawEvents: [],
        lastSeq: 0,
      },
    });
    const sent: string[] = [];
    const view = render(
      <P>
        <Composer onSend={(t) => sent.push(t)} />
      </P>,
    );
    act(() => {
      useStore.getState().startEditMessage('u1', 'old question');
    });
    await waitFor(() => {
      const field = view.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(field.value).toBe('old question');
    });
    const field = view.container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(field, { target: { value: 'corrected question' } });
    });
    act(() => {
      fireEvent.click(view.container.querySelector('[aria-label="Send message"]')!);
    });

    expect(sent).toEqual(['corrected question']);
    // Both the old question AND the stale answer under it are gone locally — `onSend` (mocked
    // here) is what appends the NEW user block in the real app (`ChatView.handleSend` →
    // `noteUserMessage`), so an empty array here is correct, not an oversight.
    expect(useStore.getState().model.blocks).toEqual([]);
  });
});

describe('Composer — @ completion dropdown selection', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
  })

  it('applies a completion on click, without needing a mousedown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ completions: ['@alice', '@bob'] }))),
    )
    const view = render(
      <P>
        <Composer onSend={() => {}} projectId="p1" />
      </P>,
    )
    const field = view.container.querySelector('textarea')! as HTMLTextAreaElement
    // Let the completions fetch resolve.
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      fireEvent.change(field, { target: { value: '@al' } })
    })
    const item = view.getByText('@alice')
    act(() => {
      fireEvent.click(item)
    })
    expect(field.value).toContain('@alice')
  })
})
