import { list, put } from "@vercel/blob";

/**
 * The bot's in-tournament memory: short factual notes collected by the
 * news sweep schedule, read back as conversation color. One blob per note,
 * same append-only pattern as the bet ledger.
 */

export interface NoteRecord {
  id: string;
  /** When the note was saved (UTC ISO). Recency drives what gets surfaced. */
  createdAt: string;
  /** UTC date of the event the note describes, YYYY-MM-DD. */
  date: string;
  /** Teams involved, full names ("Norway", "Brazil") — used for filtering. */
  teams: string[];
  /** One or two factual sentences. Facts only; the wit happens at reply time. */
  note: string;
  /** Where it came from: a domain ("bbc.com") or a tool name ("get_wc_schedule"). */
  source: string;
}

const PREFIX = "wc26-notes/";

export async function saveNote(record: NoteRecord): Promise<void> {
  await put(`${PREFIX}${record.id}.json`, JSON.stringify(record, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function listNotes(): Promise<NoteRecord[]> {
  const { blobs } = await list({ prefix: PREFIX });
  const records = await Promise.all(
    blobs.map(async (blob) => {
      const res = await fetch(blob.url);
      if (!res.ok) return null;
      return (await res.json()) as NoteRecord;
    }),
  );
  return records
    .filter((record): record is NoteRecord => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
