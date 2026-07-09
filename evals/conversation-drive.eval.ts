import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const userContext = { timeZone: "America/New_York" };
const tournamentTeams = [
  "argentina",
  "belgium",
  "england",
  "france",
  "morocco",
  "norway",
  "spain",
  "switzerland",
] as const;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string");
}

function mentionedTournamentTeams(message: string): readonly string[] {
  const normalized = message.toLowerCase();
  return tournamentTeams.filter((team) => normalized.includes(team));
}

export default defineEval({
  description:
    "Carries brief positive replies with fresh substance and reaches today's tournament before any future fixture.",
  tags: ["live"],
  timeoutMs: 180_000,
  async test(t) {
    const opener = await t.send({
      clientContext: userContext,
      message: "i havent really been following. give me one thing to talk about",
    });
    opener.calledTool("get_wc_facts", { input: { view: "recent" } });
    opener.calledTool("get_wc_schedule", { input: { view: "today" } });
    opener.notCalledTool("show_round_chances");
    t.check(
      opener.message,
      satisfies((message) => {
        const text = String(message ?? "");
        return (
          mentionedTournamentTeams(text).length === 2 &&
          !/\b(?:brazil|egypt|haaland)\b/iu.test(text)
        );
      }, "opens with one concrete current-day match, not a roundup"),
    );

    const uptake = await t.send({ clientContext: userContext, message: "yeah" });
    const laugh = await t.send({ clientContext: userContext, message: "lmao" });
    const reaction = await t.send({ clientContext: userContext, message: "wow crazy!!!" });

    const replies = [opener.message, uptake.message, laugh.message, reaction.message].map((message) =>
      String(message ?? "").trim(),
    );

    t.check(
      [replies[0], replies[1]],
      satisfies((messages) => {
        if (!isStringArray(messages)) return false;
        const openerTeams = mentionedTournamentTeams(messages[0] ?? "");
        const continuation = (messages[1] ?? "").toLowerCase();
        return openerTeams.some((team) => continuation.includes(team));
      }, "carries the current match through the first brief uptake"),
    );

    t.check(
      replies,
      satisfies(
        (messages) => {
          if (!isStringArray(messages)) return false;
          return (
            messages.every((message) => message.length >= 20) &&
            new Set(messages.map((message) => message.toLowerCase())).size === messages.length
          );
        },
        "each turn contributes distinct substance",
      ),
    );
    t.check(
      replies.slice(1),
      satisfies(
        (messages) =>
          isStringArray(messages) &&
          messages.every((message) => !/^(?:yeah|yep|right|lol|lmao|wow)\b/iu.test(message)),
        "does not parrot the user's brief reaction as an opening",
      ),
    );
    t.check(
      replies,
      satisfies((messages) => {
        if (!isStringArray(messages)) return false;
        const transcript = messages.join("\n").toLowerCase();
        const present = transcript.search(/\btoday\b|\bmorocco\b|2[-–]0/u);
        const future = transcript.search(
          /\b(?:tomorrow|friday|saturday|next match|next fixture|england|spain|belgium|switzerland)\b/u,
        );
        return present >= 0 && (future < 0 || present < future);
      }, "mentions today's tournament before any future fixture"),
    );
    t.check(
      replies,
      satisfies(
        (messages) => {
          if (!isStringArray(messages)) return false;
          return messages.every(
            (message) =>
              !/revenge or repeat|want me to|just say the word|(?:one|thing) to (?:say|talk about)|what (?:you should|to) say|worth (?:dropping|sharing)|drop(?:ping)? .{0,20}(?:chat|group)|conversation (?:starter|grenade)|group[- ]chat (?:ammo|material)|(?:clean|wider) line/iu.test(
                message,
              ),
          );
        },
        "avoids canned engagement prompts and meta-commentary",
      ),
    );

    t.noFailedActions();
    t.succeeded();
  },
});
