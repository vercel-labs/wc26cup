import { defineTool } from "eve/tools";
import { z } from "zod";
import { FactDraftSchema, saveFacts } from "../lib/facts.js";
import { writeFactBatchReceipt } from "../lib/fixture-refresh.js";

const OriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("broad"), runId: z.string().min(1) }),
  z.object({ attemptPath: z.string().min(1), kind: z.literal("pre_match"), refreshKey: z.string().min(10) }),
]);

const InputSchema = z.discriminatedUnion("result", [
  z.object({ facts: z.array(FactDraftSchema).min(1).max(4), origin: OriginSchema, result: z.literal("facts") }),
  z.object({ origin: OriginSchema, reason: z.string().min(3).max(300), result: z.literal("empty") }),
]);

const FlatInputSchema = z.object({
  result: z.enum(["facts", "empty"]),
  origin: OriginSchema,
  facts: z.array(FactDraftSchema).min(1).max(4).optional(),
  reason: z.string().min(3).max(300).optional(),
});

export default defineTool({
  description:
    "Write one complete scheduled batch to the verified World Cup fact memory. App schedules only. Every atomic claim needs direct source support; a pre-match empty batch is still recorded so the refresh can complete.",
  inputSchema: FlatInputSchema,
  async execute(rawInput, ctx) {
    const auth = ctx.session.auth.current;
    if (auth?.authenticator !== "app" || auth.principalId !== "eve:app" || auth.principalType !== "runtime") {
      return { error: "Only an app-authenticated schedule may update the shared fact memory." };
    }

    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid save_wc_facts input." };
    }
    const input = parsed.data;

    const records = await saveFacts({ drafts: input.result === "facts" ? input.facts : [], origin: input.origin });
    if (input.origin.kind === "pre_match") {
      await writeFactBatchReceipt({
        attemptPath: input.origin.attemptPath,
        emptyReason: input.result === "empty" ? input.reason : null,
        factRevisions: records.map((record) => `${record.factKey}:${record.revision}`),
        refreshKey: input.origin.refreshKey,
      });
    }
    return {
      result: input.result,
      saved: records.map((record) => ({ factKey: record.factKey, revision: record.revision })),
    };
  },
});
