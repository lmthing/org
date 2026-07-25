import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SubjectItem } from './index'

describe('SubjectItem', () => {
  it('should be defined', async () => {
    const mod = await import('./index')
    expect(mod).toBeDefined()
    expect(mod.SubjectItem).toBeDefined()
  })

  // The props are `{ slug, path }`. This case previously passed `id`/`name`, which the component
  // does not take — so the heading rendered `undefined` and `getByText('Physics')` could never have
  // matched. It went unnoticed because `vitest.config.ts` only includes `src/elements/**`, so no
  // `src/studio/**` test has ever run (42 of the 85 test files in this package execute).
  it('renders subject slug and path', () => {
    render(<SubjectItem slug="Physics" path="knowledge/science/physics" />)
    expect(screen.getByText('Physics')).toBeDefined()
    expect(screen.getByText('knowledge/science/physics')).toBeDefined()
  })
})
