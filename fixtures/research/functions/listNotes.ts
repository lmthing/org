const noteStore: Array<{ id: string; title: string; content: string; tags: string[] }> = [];

export function listNotes(tag?: string): Array<{ id: string; title: string; tags: string[] }> {
  const all = noteStore;
  if (tag) {
    return all.filter(n => n.tags.includes(tag)).map(({ id, title, tags }) => ({ id, title, tags }));
  }
  return all.map(({ id, title, tags }) => ({ id, title, tags }));
}
