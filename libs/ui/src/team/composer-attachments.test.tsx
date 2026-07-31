/**
 * Attachments in the composer — file picker, staging, remove-before-send, and a visible failure on
 * a rejected upload.
 *
 * `onUpload` stands in for `TeamClient.uploadAttachment` (wired for real in `channels-view.tsx`) —
 * this suite proves the composer's own state machine around it, not the network.
 */
import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, waitFor, act } from '../test-utils/index'
import { Composer } from './composer'
import type { Directory, ChannelAttachment } from './types'

const DIRECTORY: Directory = { members: [], projects: [] }

const file = (name: string, type: string, reportedSize?: number) => {
  // Real content is always tiny — a genuine 25MB+ blob would be slow to allocate in a test.
  // `size` is overridden directly to whatever the case under test needs to exercise, decoupled
  // from the handful of bytes actually backing the `File`.
  const f = new File(['x'], name, { type })
  if (reportedSize !== undefined) Object.defineProperty(f, 'size', { value: reportedSize })
  return f
}

describe('Composer — attachments', () => {
  it('renders no attach control at all when the caller has not wired an upload path', () => {
    const { queryByTestId } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={vi.fn()} />,
    )
    expect(queryByTestId('attach-input')).toBeNull()
  })

  it('uploads a picked file, stages it, and sends it alongside the typed text', async () => {
    const staged: ChannelAttachment = {
      id: 'u1', kind: 'image', url: '/api/uploads/u1', mediaType: 'image/png', filename: 'shot.png',
    }
    const onUpload = vi.fn().mockResolvedValue(staged)
    const onSend = vi.fn().mockResolvedValue(undefined)
    const { getByTestId, findByText, getByPlaceholderText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={onSend} onUpload={onUpload} />,
    )

    const input = getByTestId('attach-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('shot.png', 'image/png')] } })
      // The upload is async (a `FileReader` read, then `onUpload`) — let both settle.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await findByText('shot.png')).toBeTruthy()
    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'shot.png', mediaType: 'image/png' }),
    )

    const box = getByPlaceholderText('Message #general')
    fireEvent.change(box, { target: { value: 'here it is' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('here it is', [staged]))
  })

  it('does NOT send on an attachment with no text — the pod requires text on every post', async () => {
    // `routes/team-channels.ts#handlePostMessage` 400s an empty `text` regardless of
    // `attachmentIds` — there is no attachment-only message on this surface, so the composer
    // refuses locally rather than round-tripping a request the pod would only reject.
    const staged: ChannelAttachment = {
      id: 'u5', kind: 'image', url: '/api/uploads/u5', mediaType: 'image/png', filename: 'shot.png',
    }
    const onUpload = vi.fn().mockResolvedValue(staged)
    const onSend = vi.fn()
    const { getByTestId, findByText, getByPlaceholderText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={onSend} onUpload={onUpload} />,
    )
    const input = getByTestId('attach-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('shot.png', 'image/png')] } })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(await findByText('shot.png')).toBeTruthy()

    const box = getByPlaceholderText('Message #general')
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
    // Still staged — refusing to send did not silently drop it either.
    expect(await findByText('shot.png')).toBeTruthy()
  })

  it('removing a staged attachment before send drops it, and it is gone from the DOM', async () => {
    const staged: ChannelAttachment = {
      id: 'u2', kind: 'file', url: '/api/uploads/u2', mediaType: 'text/plain', filename: 'notes.txt',
    }
    const onUpload = vi.fn().mockResolvedValue(staged)
    const { getByTestId, findByText, getByLabelText, queryByText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={vi.fn()} onUpload={onUpload} />,
    )
    const input = getByTestId('attach-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('notes.txt', 'text/plain')] } })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(await findByText('notes.txt')).toBeTruthy()

    fireEvent.click(getByLabelText('Remove notes.txt'))
    await waitFor(() => expect(queryByText('notes.txt')).toBeNull())
  })

  it('shows a visible error, and does not stage anything, when the upload is rejected', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('upload exceeds 26214400 bytes'))
    const { getByTestId, findByText, queryByText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={vi.fn()} onUpload={onUpload} />,
    )
    const input = getByTestId('attach-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('huge.mp4', 'video/mp4')] } })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(await findByText('upload exceeds 26214400 bytes')).toBeTruthy()
    // Nothing silently staged over a failure a member never saw.
    expect(queryByText('huge.mp4')).toBeNull()
  })

  it('refuses a file over the 25MB cap immediately, without even trying to upload it', async () => {
    const onUpload = vi.fn()
    const { getByTestId, findByText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={vi.fn()} onUpload={onUpload} />,
    )
    const input = getByTestId('attach-input') as HTMLInputElement
    const big = file('movie.mp4', 'video/mp4', 26 * 1024 * 1024)
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } })
      await Promise.resolve()
    })
    expect(await findByText('"movie.mp4" is over the 25MB attachment limit')).toBeTruthy()
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('refuses an 11th attachment — the pod silently truncates past 10 rather than erroring', async () => {
    // `routes/team-channels.ts#MAX_MESSAGE_ATTACHMENTS` is 10, and a post over that `.slice(0,
    // 10)`s the id list with NO error — so an 11th file that looked staged and ready would
    // otherwise vanish on send with nothing telling the member it never went. Catching it here,
    // before the upload even starts, is the only place this can be visible.
    let n = 0
    const onUpload = vi.fn().mockImplementation(
      () => Promise.resolve({ id: `u${++n}`, kind: 'file' as const, url: `/api/uploads/u${n}`, mediaType: 'text/plain', filename: `f${n}.txt` }),
    )
    const { getByTestId, findByText } = render(
      <Composer placeholder="Message #general" directory={DIRECTORY} meId="me" onSend={vi.fn()} onUpload={onUpload} />,
    )
    const input = getByTestId('attach-input') as HTMLInputElement
    const ten = Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`, 'text/plain'))
    fireEvent.change(input, { target: { files: ten } })
    // Ten sequential `FileReader` reads, each a real (macro)task — `waitFor` polls rather than
    // guessing how many microtask ticks ten of them need.
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(10))

    fireEvent.change(input, { target: { files: [file('eleventh.txt', 'text/plain')] } })
    expect(await findByText('A message can carry at most 10 attachments')).toBeTruthy()
    expect(onUpload).toHaveBeenCalledTimes(10)
  })
})
