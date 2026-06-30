import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter into data + body', () => {
    const raw = '---\ntitle: Chef\nfunctions:\n  - addIngredient\n---\nDo the cooking.';
    const { data, body } = parseFrontmatter(raw);
    expect(data['title']).toBe('Chef');
    expect(data['functions']).toEqual(['addIngredient']);
    expect(body).toBe('Do the cooking.');
  });

  it('returns empty data + raw body when there is no frontmatter block', () => {
    const raw = 'just a body, no frontmatter';
    const { data, body } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(body).toBe(raw);
  });

  it('THROWS on malformed YAML instead of silently returning {}', () => {
    // Unbalanced bracket / bad indentation is a YAML parse error.
    const raw = '---\ntitle: [unclosed\n  bad: : :\n---\nbody';
    expect(() => parseFrontmatter(raw)).toThrow(/Invalid YAML frontmatter/);
  });

  it('includes the source path in the error message when provided', () => {
    const raw = '---\nfoo: "unterminated\n---\nbody';
    expect(() => parseFrontmatter(raw, '/spaces/x/instruct.md')).toThrow(
      /Invalid YAML frontmatter in \/spaces\/x\/instruct\.md/,
    );
  });

  it('treats a top-level YAML array as empty data (not an error)', () => {
    const raw = '---\n- a\n- b\n---\nbody';
    const { data, body } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(body).toBe('body');
  });
});
