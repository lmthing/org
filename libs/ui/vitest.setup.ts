// jest-dom matchers (toBeInTheDocument, toHaveClass, …) for the libs/ui component suites.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// RTL's automatic cleanup only self-registers when the test framework exposes a GLOBAL `afterEach`
// (vitest `globals: true`). This config keeps globals off, so without this hook every `render()`
// leaves its tree mounted and the next `getByTestId`/`getByRole` in the same file fails with
// "Found multiple elements". Register it explicitly.
afterEach(() => {
  cleanup()
})
