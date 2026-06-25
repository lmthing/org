/**
 * Parse a Claude Code / cowork artifact (a SKILL.md, a plugin.json, or a plugin
 * directory) into a normalized descriptor the architect can map onto an LMThing space.
 *
 * Supported inputs (auto-detected from the path):
 *  - a `SKILL.md` file            → one skill { name, description, instructions, dir }
 *  - a directory containing SKILL.md → same
 *  - a `.claude-plugin/plugin.json` → a plugin with its nested skills/commands/agents
 *  - a plugin directory             → reads `.claude-plugin/plugin.json` then its skills
 *
 * Uses only the host primitives (readFileRaw, execShell) so it runs in any VM.
 */
export function parseSkill(path: string): {
  ok: boolean;
  kind: 'skill' | 'plugin' | 'unknown';
  name: string;
  description: string;
  instructions: string;
  /** For a plugin: each bundled skill/command as its own importable unit. */
  skills: Array<{ name: string; description: string; instructions: string; source: string }>;
  /** Sibling resource files (scripts, references) found next to a skill. */
  resources: string[];
  error?: string;
} {
  const empty = { ok: false, kind: 'unknown' as const, name: '', description: '', instructions: '', skills: [], resources: [] };

  // Resolve what `path` points at.
  const lower = path.toLowerCase();
  const isSkillFile = lower.endsWith('skill.md');
  const isPluginJson = lower.endsWith('plugin.json');

  // Helper: read a file, return its text or ''.
  const read = (p: string): string => {
    const r = readFileRaw(p) as { ok: boolean; content?: string };
    return r.ok ? (r.content ?? '') : '';
  };
  // Helper: does a path exist (file or dir)?
  const exists = (p: string): boolean => {
    const r = execShell(`test -e ${JSON.stringify(p)} && echo yes`) as { ok: boolean; stdout: string };
    return r.ok && r.stdout.trim() === 'yes';
  };
  // Helper: list files matching a shell glob under a dir.
  const findFiles = (dir: string, pattern: string): string[] => {
    const r = execShell(`find ${JSON.stringify(dir)} -maxdepth 4 -name ${JSON.stringify(pattern)} 2>/dev/null`) as { ok: boolean; stdout: string };
    return r.ok ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  };

  // Parse YAML-ish frontmatter (name/description) + body from a markdown file.
  const parseMd = (text: string): { name: string; description: string; body: string } => {
    const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
    if (!m) return { name: '', description: '', body: text.trim() };
    const fm = m[1] ?? '';
    const body = (m[2] ?? '').trim();
    const grab = (key: string): string => {
      const r = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(fm);
      return r ? r[1]!.trim().replace(/^["']|["']$/g, '') : '';
    };
    return { name: grab('name'), description: grab('description'), body };
  };

  try {
    // --- A single SKILL.md (or a dir containing one) ---
    let skillMdPath = '';
    if (isSkillFile) skillMdPath = path;
    else if (!isPluginJson && exists(`${path}/SKILL.md`)) skillMdPath = `${path}/SKILL.md`;

    if (skillMdPath) {
      const text = read(skillMdPath);
      if (!text) return { ...empty, error: `could not read ${skillMdPath}` };
      const { name, description, body } = parseMd(text);
      const dir = skillMdPath.replace(/\/SKILL\.md$/i, '');
      // Sibling resources (scripts/references), excluding the SKILL.md itself.
      const resources = findFiles(dir, '*').filter((f) => !/SKILL\.md$/i.test(f) && !f.endsWith('/'));
      return {
        ok: true, kind: 'skill',
        name: name || dir.split('/').pop() || 'skill',
        description, instructions: body,
        skills: [{ name: name || 'skill', description, instructions: body, source: skillMdPath }],
        resources,
      };
    }

    // --- A plugin (plugin.json or a plugin dir) ---
    let pluginJsonPath = '';
    if (isPluginJson) pluginJsonPath = path;
    else if (exists(`${path}/.claude-plugin/plugin.json`)) pluginJsonPath = `${path}/.claude-plugin/plugin.json`;

    if (pluginJsonPath) {
      const meta = JSON.parse(read(pluginJsonPath) || '{}') as { name?: string; description?: string };
      const pluginRoot = pluginJsonPath.replace(/\/?\.claude-plugin\/plugin\.json$/i, '');
      // Gather bundled SKILL.md files and command/agent markdown as importable units.
      const skillFiles = findFiles(pluginRoot, 'SKILL.md');
      const skills = skillFiles.map((sf) => {
        const { name, description, body } = parseMd(read(sf));
        return { name: name || sf.split('/').slice(-2)[0] || 'skill', description, instructions: body, source: sf };
      });
      return {
        ok: true, kind: 'plugin',
        name: meta.name || pluginRoot.split('/').pop() || 'plugin',
        description: meta.description ?? '',
        instructions: `Plugin "${meta.name}" — ${meta.description ?? ''}. Bundles ${skills.length} skill(s).`,
        skills,
        resources: [],
      };
    }

    return { ...empty, error: `path is neither a SKILL.md, plugin.json, nor a directory containing them: ${path}` };
  } catch (e) {
    return { ...empty, error: String((e as Error)?.message ?? e) };
  }
}
