import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { notesSchemaExtensions } from '@/components/editor/extensions';

let cached: Schema | undefined;

/**
 * The notes' ProseMirror schema, built from the same extensions as the editor. It is what makes a
 * restore safe: content passed through it can only contain the nodes and marks the editor knows.
 */
export function notesSchema(): Schema {
  cached ??= getSchema(notesSchemaExtensions());
  return cached;
}
