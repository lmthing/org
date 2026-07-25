import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import {
  useAppApi,
  type AppManifest,
  type AppTable,
  type DataPage,
} from '../-lib/appApi'

const PAGE_SIZE = 25

/**
 * Data browser: pick a table → paged rows → inline-edit a cell (PATCH by id).
 * Edits target the row's primary-key column (falls back to `id`).
 */
function DataBrowser() {
  const { projectId } = useParams({ from: '/studio/$projectId/app' })
  const api = useAppApi(projectId)

  const [tables, setTables] = useState<AppTable[]>([])
  const [table, setTable] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<DataPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the table list from the manifest.
  useEffect(() => {
    const ac = new AbortController()
    api
      .getManifest(ac.signal)
      .then((m: AppManifest) => {
        const ts = m.tables ?? []
        setTables(ts)
        setTable((cur) => cur ?? ts[0]?.name ?? null)
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ac.abort()
  }, [api])

  const pkColumn = useMemo(() => {
    const t = tables.find((x) => x.name === table)
    return t?.columns?.find((c) => c.primaryKey)?.name ?? 'id'
  }, [tables, table])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!table) return
      setLoading(true)
      setError(null)
      try {
        const d = await api.getData(table, { page, pageSize: PAGE_SIZE, signal })
        setData(d)
      } catch (e) {
        if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [api, table, page],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const rows = data?.rows ?? []
  const columns = useMemo(() => {
    const declared = tables.find((t) => t.name === table)?.columns?.map((c) => c.name)
    if (declared && declared.length) return declared
    // Fall back to keys present in the first row.
    return rows.length ? Object.keys(rows[0]) : []
  }, [tables, table, rows])

  const total = data?.total
  const hasNext = total != null ? (page + 1) * PAGE_SIZE < total : rows.length === PAGE_SIZE

  const saveCell = useCallback(
    async (rowId: string, column: string, value: string) => {
      if (!table) return
      try {
        await api.patchRow(table, rowId, { [column]: value })
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [api, table, load],
  )

  return (
    <Prim.Box height="100%" display="flex" flexDirection="column" minHeight={0}>
      {/* Table picker */}
      <Prim.Box
        display="flex" alignItems="center" gap="0.5rem" paddingVertical="0.75rem" paddingHorizontal="1.5rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)" flexWrap="wrap"
      >
        {tables.length === 0 ? (
          <Caption muted>No tables in this project.</Caption>
        ) : (
          tables.map((t) => (
            <Button
              key={t.name}
              variant={t.name === table ? 'primary' : 'ghost'}
              onClick={() => {
                setTable(t.name)
                setPage(0)
              }}
              style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
            >
              {t.name}
            </Button>
          ))
        )}
      </Prim.Box>

      {error ? (
        <Caption style={{ padding: '0.5rem 1.5rem', color: 'var(--color-destructive)' }}>
          {error}
        </Caption>
      ) : null}

      {/* Rows */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto" minHeight={0}>
        {loading && !data ? (
          <Prim.Box padding="1.5rem" opacity={0.6} fontSize="0.875rem">Loading rows…</Prim.Box>
        ) : rows.length === 0 ? (
          <Prim.Box padding="1.5rem" opacity={0.6} fontSize="0.875rem">
            {table ? 'No rows.' : 'Select a table.'}
          </Prim.Box>
        ) : (
          <Prim.Table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8125rem' }}>
            <Prim.Thead>
              <Prim.Tr>
                {columns.map((c) => (
                  <Prim.Th
                    key={c}
                    textAlign="left" paddingVertical="0.5rem" paddingHorizontal="0.75rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)" fontFamily="monospace" position="sticky" top={0} backgroundColor="var(--color-background)" whiteSpace="nowrap"
                  >
                    {c}
                    {c === pkColumn ? <Prim.Text opacity={0.5}> (pk)</Prim.Text> : null}
                  </Prim.Th>
                ))}
              </Prim.Tr>
            </Prim.Thead>
            <Prim.Tbody>
              {rows.map((row, i) => {
                const rowId = String(row[pkColumn] ?? row.id ?? i)
                return (
                  <Prim.Tr key={rowId}>
                    {columns.map((c) => (
                      <Cell
                        key={c}
                        value={row[c]}
                        editable={c !== pkColumn}
                        onSave={(v) => saveCell(rowId, c, v)}
                      />
                    ))}
                  </Prim.Tr>
                )
              })}
            </Prim.Tbody>
          </Prim.Table>
        )}
      </Prim.Box>

      {/* Pager */}
      <Prim.Box
        display="flex" alignItems="center" gap="0.75rem" paddingVertical="0.5rem" paddingHorizontal="1.5rem" borderTopWidth="1px" borderTopStyle="solid" borderTopColor="var(--color-border)"
      >
        <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Prev
        </Button>
        <Caption muted>
          Page {page + 1}
          {total != null ? ` · ${total} rows` : ''}
        </Caption>
        <Button variant="outline" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}

/** One editable cell: click to edit, Enter/blur to PATCH, Esc to cancel. */
function Cell({
  value,
  editable,
  onSave,
}: {
  value: unknown
  editable: boolean
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const initial = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const [draft, setDraft] = useState(initial)

  const td: React.CSSProperties = {
    padding: '0.375rem 0.75rem',
    borderBottom: '1px solid var(--color-border)',
    maxWidth: 320,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: editable ? 'text' : 'default',
  }

  if (editing) {
    return (
      <Prim.Td style={{ ...td, padding: '0.125rem 0.25rem' }}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== initial) onSave(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setEditing(false)
              if (draft !== initial) onSave(draft)
            } else if (e.key === 'Escape') {
              setDraft(initial)
              setEditing(false)
            }
          }}
          style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
        />
      </Prim.Td>
    )
  }

  return (
    <Prim.Td
      style={td}
      title={initial}
      onClick={() => {
        if (editable) {
          setDraft(initial)
          setEditing(true)
        }
      }}
    >
      {initial === '' ? <Prim.Text opacity={0.35}>∅</Prim.Text> : initial}
    </Prim.Td>
  )
}

export const Route = createFileRoute('/studio/$projectId/app/data/')({
  component: DataBrowser,
})
