import { z } from "zod";
import { listAllBlobs, putJsonIfAbsent, readBlobJson } from "./blob.js";
import { FixtureSchema, type Fixture } from "./fixtures.js";

const ROOT = "wc26-refresh/v1";
const DUE_PREFIX = `${ROOT}/due/`;
const COMPLETE_PREFIX = `${ROOT}/complete/`;
const SUPERSEDED_PREFIX = `${ROOT}/superseded/`;
const ATTEMPT_PREFIX = `${ROOT}/attempt/`;
const RECEIPT_PREFIX = `${ROOT}/receipt/`;
const FIVE_MINUTES_MS = 5 * 60_000;

export const DueRowSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }),
  fixture: FixtureSchema,
  refreshKey: z.string().min(10),
  schemaVersion: z.literal(1),
});

export type DueRow = z.infer<typeof DueRowSchema>;

const FactBatchReceiptSchema = z.object({
  attemptPath: z.string().min(1),
  completedAt: z.string().datetime({ offset: true }),
  emptyReason: z.string().min(3).max(300).nullable(),
  factRevisions: z.array(z.string().min(1)),
  refreshKey: z.string().min(10),
  schemaVersion: z.literal(1),
});

export type FactBatchReceipt = z.infer<typeof FactBatchReceiptSchema>;

export interface DueJob {
  readonly pathname: string;
  readonly row: DueRow;
}

interface ParsedDuePath {
  readonly dueAtMs: number;
  readonly fixtureId: string;
  readonly refreshKey: string;
}

function timestamp(value: number): string {
  return String(value).padStart(15, "0");
}

export function refreshKeyForFixture(fixture: Fixture): string {
  return `${fixture.id}-${fixture.revision}`;
}

export function duePathForFixture(fixture: Fixture): string {
  const dueAtMs = new Date(fixture.kickoffUtc).getTime() - 30 * 60_000;
  return `${DUE_PREFIX}${timestamp(dueAtMs)}-${refreshKeyForFixture(fixture)}.json`;
}

function parseDuePath(pathname: string): ParsedDuePath | null {
  if (!pathname.startsWith(DUE_PREFIX) || !pathname.endsWith(".json")) return null;
  const filename = pathname.slice(DUE_PREFIX.length, -".json".length);
  const firstDash = filename.indexOf("-");
  const secondDash = filename.indexOf("-", firstDash + 1);
  if (firstDash !== 15 || secondDash <= firstDash + 1) return null;
  const dueAtMs = Number(filename.slice(0, firstDash));
  const fixtureId = filename.slice(firstDash + 1, secondDash);
  const revision = filename.slice(secondDash + 1);
  if (!Number.isSafeInteger(dueAtMs) || !fixtureId || !/^[a-z0-9]+$/i.test(revision)) return null;
  return { dueAtMs, fixtureId, refreshKey: `${fixtureId}-${revision}` };
}

export function selectDuePathnames(input: {
  readonly completedRefreshKeys: ReadonlySet<string>;
  readonly now: number;
  readonly pathnames: readonly string[];
  readonly supersededRefreshKeys: ReadonlySet<string>;
}): readonly string[] {
  return input.pathnames
    .map((pathname) => ({ parsed: parseDuePath(pathname), pathname }))
    .filter((entry): entry is { parsed: ParsedDuePath; pathname: string } => entry.parsed !== null)
    .filter((entry) => entry.parsed.dueAtMs <= input.now)
    .filter((entry) => !input.completedRefreshKeys.has(entry.parsed.refreshKey))
    .filter((entry) => !input.supersededRefreshKeys.has(entry.parsed.refreshKey))
    .sort((left, right) => left.pathname.localeCompare(right.pathname))
    .map((entry) => entry.pathname);
}

function markerKey(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) return null;
  return pathname.slice(prefix.length, -".json".length);
}

async function markerKeys(prefix: string): Promise<ReadonlySet<string>> {
  const blobs = await listAllBlobs(prefix);
  return new Set(blobs.map((blob) => markerKey(blob.pathname, prefix)).filter((key): key is string => key !== null));
}

export function buildDueRow(fixture: Fixture, now: Date = new Date()): DueRow {
  return DueRowSchema.parse({
    createdAt: now.toISOString(),
    dueAt: new Date(new Date(fixture.kickoffUtc).getTime() - 30 * 60_000).toISOString(),
    fixture,
    refreshKey: refreshKeyForFixture(fixture),
    schemaVersion: 1,
  });
}

export async function materializeDueRows(fixtures: readonly Fixture[], now: Date = new Date()): Promise<number> {
  const schedulable = fixtures.filter(
    (fixture) => fixture.status.kind === "scheduled" || fixture.status.kind === "postponed",
  );
  const existing = await listAllBlobs(DUE_PREFIX);
  let created = 0;

  for (const fixture of schedulable) {
    const row = buildDueRow(fixture, now);
    if (await putJsonIfAbsent(duePathForFixture(fixture), row)) created += 1;

    for (const blob of existing) {
      const parsed = parseDuePath(blob.pathname);
      if (parsed?.fixtureId === fixture.id && parsed.refreshKey !== row.refreshKey) {
        await markSuperseded(parsed.refreshKey, {
          at: now.toISOString(),
          reason: "fixture_revision_changed",
          replacementRefreshKey: row.refreshKey,
        });
      }
    }
  }
  return created;
}

export async function listDueJobs(now: Date = new Date()): Promise<readonly DueJob[]> {
  const [dueBlobs, completedRefreshKeys, supersededRefreshKeys] = await Promise.all([
    listAllBlobs(DUE_PREFIX),
    markerKeys(COMPLETE_PREFIX),
    markerKeys(SUPERSEDED_PREFIX),
  ]);
  const selected = new Set(
    selectDuePathnames({
      completedRefreshKeys,
      now: now.getTime(),
      pathnames: dueBlobs.map((blob) => blob.pathname),
      supersededRefreshKeys,
    }),
  );

  const jobs: DueJob[] = [];
  for (const blob of dueBlobs) {
    if (!selected.has(blob.pathname)) continue;
    const parsed = DueRowSchema.safeParse(await readBlobJson(blob.url));
    if (parsed.success) jobs.push({ pathname: blob.pathname, row: parsed.data });
  }
  return jobs;
}

function attemptPath(refreshKey: string, now: Date): string {
  const bucket = Math.floor(now.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  return `${ATTEMPT_PREFIX}${refreshKey}/${timestamp(bucket)}.json`;
}

export async function claimDueJob(job: DueJob, now: Date = new Date()): Promise<string | null> {
  const pathname = attemptPath(job.row.refreshKey, now);
  const created = await putJsonIfAbsent(pathname, {
    attemptedAt: now.toISOString(),
    duePath: job.pathname,
    refreshKey: job.row.refreshKey,
    schemaVersion: 1,
  });
  return created ? pathname : null;
}

function attemptId(pathname: string): string {
  const filename = pathname.split("/").at(-1);
  if (!filename?.endsWith(".json")) throw new Error(`Invalid refresh attempt pathname: ${pathname}`);
  return filename.slice(0, -".json".length);
}

function receiptPath(refreshKey: string, attemptPathname: string): string {
  return `${RECEIPT_PREFIX}${refreshKey}/${attemptId(attemptPathname)}.json`;
}

export async function writeFactBatchReceipt(input: {
  readonly attemptPath: string;
  readonly emptyReason: string | null;
  readonly factRevisions: readonly string[];
  readonly now?: Date;
  readonly refreshKey: string;
}): Promise<FactBatchReceipt> {
  const receipt = FactBatchReceiptSchema.parse({
    attemptPath: input.attemptPath,
    completedAt: (input.now ?? new Date()).toISOString(),
    emptyReason: input.emptyReason,
    factRevisions: input.factRevisions,
    refreshKey: input.refreshKey,
    schemaVersion: 1,
  });
  await putJsonIfAbsent(receiptPath(input.refreshKey, input.attemptPath), receipt);
  return receipt;
}

export async function completeRefreshFromBatchReceipt(input: {
  readonly attemptPath: string;
  readonly now?: Date;
  readonly refreshKey: string;
}): Promise<boolean> {
  const pathname = receiptPath(input.refreshKey, input.attemptPath);
  const blobs = await listAllBlobs(pathname);
  const blob = blobs.find((candidate) => candidate.pathname === pathname);
  if (!blob) return false;
  const parsed = FactBatchReceiptSchema.safeParse(await readBlobJson(blob.url));
  if (!parsed.success || parsed.data.refreshKey !== input.refreshKey || parsed.data.attemptPath !== input.attemptPath) {
    return false;
  }
  await putJsonIfAbsent(`${COMPLETE_PREFIX}${input.refreshKey}.json`, {
    at: (input.now ?? new Date()).toISOString(),
    receiptPath: pathname,
    refreshKey: input.refreshKey,
    schemaVersion: 1,
  });
  return true;
}

export async function markSuperseded(refreshKey: string, reason: unknown): Promise<void> {
  await putJsonIfAbsent(`${SUPERSEDED_PREFIX}${refreshKey}.json`, reason);
}

export function isFixtureDue(fixture: Fixture, now: Date): boolean {
  if (fixture.status.kind !== "scheduled") return false;
  const kickoff = new Date(fixture.kickoffUtc).getTime();
  return now.getTime() >= kickoff - 30 * 60_000 && now.getTime() < kickoff;
}
