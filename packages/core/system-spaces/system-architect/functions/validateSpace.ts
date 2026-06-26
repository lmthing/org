/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * Validate that a scaffolded space directory is structurally correct before
 * passing it to registerSpace(). Uses readFileRaw and execShell ls only.
 *
 * @param dir Absolute path to the space directory.
 * @returns   { ok, errors: string[] }
 */
export function validateSpace(dir: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const agentsDirCheck = execShell(`ls "${joinPath(dir, 'agents')}" 2>&1`);
  if (!agentsDirCheck.ok || agentsDirCheck.stderr.includes('No such')) {
    errors.push(`Missing agents/ directory`);
    return { ok: false, errors };
  }

  const agentSlugs = agentsDirCheck.stdout.trim().split('\n').filter(Boolean);
  if (agentSlugs.length === 0) {
    errors.push('agents/ directory is empty — at least one agent required');
    return { ok: false, errors };
  }

  for (const slug of agentSlugs) {
    const instructPath = joinPath(dir, 'agents', slug, 'instruct.md');
    const instructRead = readFileRaw(instructPath);
    if (!instructRead.ok) {
      errors.push(`Agent "${slug}": missing instruct.md (${instructRead.error})`);
      continue;
    }

    const content = instructRead.content;
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      errors.push(`Agent "${slug}": instruct.md has no YAML frontmatter`);
      continue;
    }

    const fm = fmMatch[1] ?? '';

    // Extract functions list
    const fnLines = (fm.match(/^functions:\s*\n((?:  - .+\n?)*)/m) ?? [])[1] ?? '';
    const functionNames = fnLines.trim().split('\n')
      .map((l: string) => l.replace(/^\s*-\s*/, '').trim())
      .filter((n: string) => n && n !== '[]');

    for (const fnName of functionNames) {
      const fnRead = readFileRaw(joinPath(dir, 'functions', `${fnName}.ts`), { limit: 2000 });
      if (!fnRead.ok) {
        errors.push(`Agent "${slug}": function "${fnName}" declared but functions/${fnName}.ts not found`);
        continue;
      }
      // best-effort: import statements are forbidden in the QuickJS host
      if (/^\s*import\s/m.test(fnRead.content)) {
        errors.push(`Agent "${slug}": function "${fnName}" uses a forbidden import statement (host has no module system)`);
      }
      // best-effort: must have at least one export to be callable
      if (!/export\s+(function|const|default)/.test(fnRead.content)) {
        errors.push(`Agent "${slug}": function "${fnName}" has no export — it will not be callable`);
      }
    }

    // Check knowledge tree
    const kLines = (fm.match(/^knowledge:\s*\n((?:  - .+\n?)*)/m) ?? [])[1] ?? '';
    const knowledgeRefs = kLines.trim().split('\n')
      .map((l: string) => l.replace(/^\s*-\s*/, '').trim())
      .filter((n: string) => n && n !== '[]');

    for (const ref of knowledgeRefs) {
      const parts = ref.split('/');
      if (parts.length !== 2) {
        errors.push(`Agent "${slug}": knowledge ref "${ref}" must be "<domain>/<field>"`);
        continue;
      }
      const fieldDir = joinPath(dir, 'knowledge', parts[0]!, parts[1]!);
      const idx = readFileRaw(joinPath(fieldDir, 'index.md'), { limit: 500 });
      if (!idx.ok) {
        errors.push(`Agent "${slug}": knowledge "${ref}" declared but knowledge/${ref}/index.md not found`);
        continue;
      }
      if (!/^variable:\s*\S+/m.test(idx.content)) {
        errors.push(`Agent "${slug}": knowledge "${ref}" index.md missing required "variable:" frontmatter`);
      }
      const optLs = execShell(`ls -1 "${fieldDir}" 2>&1`);
      const optFiles = optLs.ok
        ? optLs.stdout.trim().split('\n').filter((f: string) => f.endsWith('.md') && f !== 'index.md')
        : [];
      if (optFiles.length === 0) {
        errors.push(`Agent "${slug}": knowledge "${ref}" has no option .md files (besides index.md)`);
      }
    }

    // Check components
    const cLines = (fm.match(/^components:\s*\n((?:  - .+\n?)*)/m) ?? [])[1] ?? '';
    const componentNames = cLines.trim().split('\n')
      .map((l: string) => l.replace(/^\s*-\s*/, '').trim())
      .filter((n: string) => n && n !== '[]');

    for (const comp of componentNames) {
      const viewFile = readFileRaw(joinPath(dir, 'components', 'view', `${comp}.tsx`), { limit: 1 });
      const formFile = readFileRaw(joinPath(dir, 'components', 'form', `${comp}.tsx`), { limit: 1 });
      if (!viewFile.ok && !formFile.ok) {
        errors.push(`Agent "${slug}": component "${comp}" declared but no components/view/${comp}.tsx or components/form/${comp}.tsx found`);
      }
    }

    // Check tasklist references
    const tasklistRefs = [...fm.matchAll(/tasklist:\s*(\S+)/g)].map((m: RegExpMatchArray) => m[1]!);
    for (const tl of tasklistRefs) {
      const tlCheck = execShell(`ls "${joinPath(dir, 'tasklists', tl)}" 2>&1`);
      if (!tlCheck.ok || tlCheck.stderr.includes('No such')) {
        errors.push(`Agent "${slug}": action references tasklist "${tl}" but no directory found`);
        continue;
      }

      const tlFiles = tlCheck.stdout.trim().split('\n').filter((f: string) => f.endsWith('.md'));
      if (tlFiles.length === 0) {
        errors.push(`Tasklist "${tl}": directory exists but contains no .md files`);
        continue;
      }

      const goalCount = tlFiles.filter((f: string) => {
        const r = readFileRaw(joinPath(dir, 'tasklists', tl, f), { limit: 500 });
        return r.ok && /^goal:\s*true/m.test(r.content);
      }).length;

      if (goalCount === 0) {
        errors.push(`Tasklist "${tl}": no task has goal: true`);
      } else if (goalCount > 1) {
        errors.push(`Tasklist "${tl}": ${goalCount} tasks have goal: true (exactly one required)`);
      }

      // Check dependsOn integrity: collect real task ids then validate every dependsOn entry
      const idSet = new Set<string>();
      for (const f of tlFiles) {
        const r = readFileRaw(joinPath(dir, 'tasklists', tl, f), { limit: 500 });
        const m = r.ok ? r.content.match(/^id:\s*(\S+)/m) : null;
        if (m) idSet.add(m[1]!);
      }
      for (const f of tlFiles) {
        const r = readFileRaw(joinPath(dir, 'tasklists', tl, f), { limit: 500 });
        if (!r.ok) continue;
        const depMatch = r.content.match(/^dependsOn:\s*\[([^\]]*)\]/m);
        const taskDeps = depMatch
          ? depMatch[1]!.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
        for (const d of taskDeps) {
          if (!idSet.has(d)) {
            errors.push(`Tasklist "${tl}": task in "${f}" dependsOn "${d}" which is not a known task id`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
