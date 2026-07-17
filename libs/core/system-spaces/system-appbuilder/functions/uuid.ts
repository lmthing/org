/** Generate a fresh random id (UUID v4). Use it ONLY when you must know a row's primary key UP FRONT to wire a relation: mint it once into a `const`, then use that same value as the parent row's `id` AND the child row's foreign key. You never need it merely to fill an `id` — a table's generated primary key is filled by the SYSTEM when you leave `id` off the row object, so omit it unless a relation forces your hand. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
