const notes: Array<{ id: string; title: string; content: string; tags: string[] }> = [];

export function saveNote(title: string, content: string, tags: string[] = []): string {
  const id = `note-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  notes.push({ id, title, content, tags });
  console.log(`Saved note: ${title}`);
  return id;
}
