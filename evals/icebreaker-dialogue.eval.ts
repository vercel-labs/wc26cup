import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default defineEval({
  description:
    "Carries a non-fan from one verified match hook into a future fixture, comparable live odds, and a fictitious exact-score offer.",
  tags: ["live"],
  timeoutMs: 180_000,
  async test(t) {
    const opener = await t.send(
      "I'm not watching the World Cup. I only heard that the blonde Norway attacker carried them against Brazil. Give me a fun icebreaker.",
    );
    opener.calledTool("get_wc_facts");
    opener.messageIncludes(/Brazil|Norway|Haaland/i);
    opener.messageIncludes(/\?/u);
    t.check(
      opener.message,
      satisfies(
        (message) => !/79|90|2-1|quarterfinal/iu.test(String(message)),
        "keeps the fact reveal for the user's answer",
      ),
    );

    const matchMoment = await t.send("Nope, I missed Brazil–Norway. What exactly does the stored fact support?");
    matchMoment.messageIncludes(/Haaland|late|79|90|two/i);
    t.check(
      matchMoment.message,
      satisfies(
        (message) => !/came off the bench|substitute|from 1-0 down|turn(?:ed)? 1-0/iu.test(String(message)),
        "does not invent lineup or prior-score details",
      ),
    );

    const nextMatch = await t.send(
      "That's wild. What is the next scheduled World Cup match? Check the fixture list and give me its venue-local time.",
    );
    nextMatch.calledTool("get_wc_schedule");
    nextMatch.messageIncludes(/at|today|tomorrow|Jul|July/i);

    const playerBridge = await t.send(
      "Different thought: I kind of like Thierry Henry. Treat that as a historical France connection, not a current player.",
    );
    t.check(
      playerBridge.message,
      satisfies(
        (message) => !/Henry (?:is|plays|starts)(?: for)? (?:current|2026) France/iu.test(String(message)),
        "does not present Thierry Henry as a current France player",
      ),
    );

    const prices = await t.send(
      "For the next scheduled match you just named, what do Polymarket and Kalshi say about who advances?",
    );
    prices.calledTool("get_wc_odds", { input: { contractKind: "advance", view: "match" } });
    t.check(prices.message, includes(/Polymarket|Kalshi/i));

    const score = await t.send(
      "Okay, I'll take the underdog in that match, 2-1. Offer me the fake prediction, but don't record it yet.",
    );
    score.messageIncludes(/Belgium|underdog|2.?1/i);

    t.notCalledTool("record_bet");
    t.noFailedActions();
    t.succeeded();
  },
});
