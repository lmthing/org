import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface JudgeVerdict {
  passed: boolean
  score: number // 0–10
  summary: string
  issues: JudgeIssue[]
  raw: string
}

export interface JudgeIssue {
  severity: 'critical' | 'major' | 'minor'
  description: string
  element?: string
  suggestion?: string
}

export interface AutoFixResult {
  applied: boolean
  files: Array<{ path: string; original: string; patched: string }>
  diff: string
  explanation: string
}

/**
 * LLM-as-a-judge for visual and functional correctness of the web chat UI.
 * Uses Claude with vision to evaluate screenshots against criteria.
 * Requires ANTHROPIC_API_KEY in the environment.
 */
export class LLMJudge {
  private readonly model: string
  private readonly anthropic: ReturnType<typeof createAnthropic>
  private enabled: boolean

  constructor(model = 'claude-sonnet-4-6') {
    this.model = model
    this.enabled = !!process.env['ANTHROPIC_API_KEY']
    if (!this.enabled) {
      console.warn('[LLMJudge] ANTHROPIC_API_KEY not set — judge calls will be skipped')
    }
    this.anthropic = createAnthropic({
      apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    })
  }

  /** Evaluate the current page state against the given criteria. */
  async evaluate(
    page: Page,
    criteria: string[],
    options: {
      includeHtml?: boolean
      focus?: string // CSS selector to focus screenshot on
    } = {},
  ): Promise<JudgeVerdict> {
    if (!this.enabled) return this.skipVerdict(criteria)

    const screenshot = await this.captureScreenshot(page, options.focus)
    const screenshotBase64 = screenshot.toString('base64')
    const html = options.includeHtml ? await page.content() : undefined

    const prompt = this.buildEvalPrompt(criteria, html)

    try {
      const { text } = await generateText({
        model: this.anthropic(this.model),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image',
                image: screenshotBase64,
              },
            ],
          },
        ],
      })

      return this.parseVerdict(text, criteria)
    } catch (err) {
      console.error('[LLMJudge] evaluation error:', err)
      return {
        passed: false,
        score: 0,
        summary: `Judge error: ${String(err)}`,
        issues: [{ severity: 'critical', description: `LLM evaluation failed: ${String(err)}` }],
        raw: '',
      }
    }
  }

  /**
   * Evaluate whether a specific UI behavior matches expectations using
   * DOM content (no screenshot) for faster, cheaper checks.
   */
  async evaluateText(
    page: Page,
    criteria: string[],
    selector?: string,
  ): Promise<JudgeVerdict> {
    if (!this.enabled) return this.skipVerdict(criteria)

    const content = selector
      ? await page.locator(selector).innerHTML().catch(() => '')
      : await page.content()

    const prompt = `
You are a UI quality judge. Evaluate the following HTML content against these criteria.

**Criteria:**
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**HTML Content:**
\`\`\`html
${content.slice(0, 8000)}
\`\`\`

Respond in this exact JSON format:
{
  "passed": true/false,
  "score": 0-10,
  "summary": "one-sentence summary",
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "what's wrong",
      "element": "CSS selector or element name (optional)",
      "suggestion": "how to fix (optional)"
    }
  ]
}
`.trim()

    try {
      const { text } = await generateText({
        model: this.anthropic(this.model),
        messages: [{ role: 'user', content: prompt }],
      })
      return this.parseVerdict(text, criteria)
    } catch (err) {
      return this.errorVerdict(err)
    }
  }

  /**
   * Auto-fix detected issues by asking the LLM to patch source files.
   * Only writes files if `apply` is true.
   */
  async autoFix(
    verdict: JudgeVerdict,
    sourceFiles: string[],
    options: { apply?: boolean; rootDir?: string } = {},
  ): Promise<AutoFixResult> {
    if (!this.enabled || verdict.passed) {
      return { applied: false, files: [], diff: '', explanation: 'No fixes needed' }
    }

    const root = options.rootDir ?? resolve(process.cwd(), '../../')

    const fileContents = sourceFiles.map((f) => {
      const absPath = resolve(root, f)
      try {
        return { path: f, absPath, content: readFileSync(absPath, 'utf-8') }
      } catch {
        return { path: f, absPath, content: `// File not found: ${f}` }
      }
    })

    const issueList = verdict.issues
      .map(
        (i) =>
          `- [${i.severity.toUpperCase()}] ${i.description}${i.element ? ` (element: ${i.element})` : ''}${i.suggestion ? `\n  Fix: ${i.suggestion}` : ''}`,
      )
      .join('\n')

    const prompt = `
You are a frontend engineer fixing UI bugs in a React + CSS web chat component.

**Issues found by the UI judge:**
${issueList}

**Source files to potentially modify:**
${fileContents.map((f) => `\n--- ${f.path} ---\n${f.content}`).join('\n')}

Generate ONLY the minimal diffs/patches needed to fix the issues.
Respond in this exact JSON format:
{
  "explanation": "one paragraph describing the fixes",
  "files": [
    {
      "path": "relative/path/to/file",
      "patch": "the complete new file content"
    }
  ]
}

If no fix is possible or the issues are in the test setup, set "files" to [].
`.trim()

    try {
      const { text } = await generateText({
        model: this.anthropic(this.model),
        messages: [{ role: 'user', content: prompt }],
      })

      return this.applyFix(text, fileContents, options.apply ?? false)
    } catch (err) {
      return {
        applied: false,
        files: [],
        diff: '',
        explanation: `Auto-fix failed: ${String(err)}`,
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async captureScreenshot(page: Page, selector?: string): Promise<Buffer> {
    if (selector) {
      const el = page.locator(selector)
      return el.screenshot({ type: 'png' })
    }
    return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
  }

  private buildEvalPrompt(criteria: string[], html?: string): string {
    return `
You are a UI quality judge evaluating a web chat application screenshot.

**Criteria to evaluate:**
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${html ? `**HTML snapshot (first 4000 chars):**\n\`\`\`html\n${html.slice(0, 4000)}\n\`\`\`` : ''}

Look at the screenshot and assess each criterion. Respond in this exact JSON format:
{
  "passed": true/false,
  "score": 0-10,
  "summary": "one-sentence summary of the evaluation",
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "what's wrong",
      "element": "CSS selector or element name (optional)",
      "suggestion": "how to fix (optional)"
    }
  ]
}

If all criteria pass, set "passed": true and "issues": [].
`.trim()
  }

  private parseVerdict(raw: string, criteria: string[]): JudgeVerdict {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      const parsed = JSON.parse(jsonMatch[0]) as Partial<JudgeVerdict>
      return {
        passed: parsed.passed ?? false,
        score: parsed.score ?? 0,
        summary: parsed.summary ?? 'No summary',
        issues: (parsed.issues ?? []) as JudgeIssue[],
        raw,
      }
    } catch {
      // If we can't parse JSON, check if the text says pass/fail
      const passKeywords = ['pass', 'correct', 'good', 'all criteria met']
      const failKeywords = ['fail', 'issue', 'missing', 'wrong', 'incorrect']
      const lc = raw.toLowerCase()
      const passed = passKeywords.some((k) => lc.includes(k)) && !failKeywords.some((k) => lc.includes(k))
      return {
        passed,
        score: passed ? 7 : 3,
        summary: raw.slice(0, 200),
        issues: passed
          ? []
          : [{ severity: 'major', description: 'Could not parse judge response; manual review needed' }],
        raw,
      }
    }
  }

  private applyFix(
    raw: string,
    fileContents: Array<{ path: string; absPath: string; content: string }>,
    apply: boolean,
  ): AutoFixResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in fix response')
      const parsed = JSON.parse(jsonMatch[0]) as {
        explanation: string
        files: Array<{ path: string; patch: string }>
      }

      const result: AutoFixResult = {
        applied: false,
        files: [],
        diff: '',
        explanation: parsed.explanation ?? '',
      }

      for (const fix of parsed.files ?? []) {
        const original = fileContents.find((f) => f.path === fix.path)
        if (!original) continue
        result.files.push({ path: fix.path, original: original.content, patched: fix.patch })
        result.diff += `\n--- ${fix.path}\n+++ ${fix.path} (patched)\n`

        if (apply) {
          writeFileSync(original.absPath, fix.patch, 'utf-8')
          result.applied = true
        }
      }

      return result
    } catch (err) {
      return {
        applied: false,
        files: [],
        diff: '',
        explanation: `Parse error: ${String(err)}\nRaw: ${raw.slice(0, 500)}`,
      }
    }
  }

  private skipVerdict(criteria: string[]): JudgeVerdict {
    return {
      passed: true,
      score: -1,
      summary: 'Skipped — ANTHROPIC_API_KEY not set',
      issues: [],
      raw: '',
    }
  }

  private errorVerdict(err: unknown): JudgeVerdict {
    return {
      passed: false,
      score: 0,
      summary: `Judge error: ${String(err)}`,
      issues: [{ severity: 'critical', description: String(err) }],
      raw: '',
    }
  }
}

/** Playwright TestInfo.attach signature (subset we use) */
export interface AttachFn {
  (name: string, options?: { body?: Buffer | string; contentType?: string }): Promise<void>
}

/**
 * Convenience: run judge and attach verdict to test report.
 * If issues are found and AUTOFIX=1, attempts automated fixes.
 */
export async function judgeAndFix(
  judge: LLMJudge,
  page: Page,
  criteria: string[],
  sourceFiles: string[] = [],
  opts: { focus?: string; attach?: AttachFn } = {},
): Promise<JudgeVerdict> {
  const verdict = await judge.evaluate(page, criteria, { focus: opts.focus })

  if (opts.attach) {
    await opts.attach('llm-judge-verdict', {
      body: JSON.stringify(verdict, null, 2),
      contentType: 'application/json',
    })
  }

  if (!verdict.passed && sourceFiles.length > 0 && process.env['AUTOFIX'] === '1') {
    const fix = await judge.autoFix(verdict, sourceFiles, { apply: true })
    if (opts.attach && fix.diff) {
      await opts.attach('llm-judge-autofix', {
        body: fix.explanation + '\n\n' + fix.diff,
        contentType: 'text/plain',
      })
    }
  }

  return verdict
}
