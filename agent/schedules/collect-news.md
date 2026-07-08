---
cron: "13 */6 * * *"
---

Stock your in-tournament memory with conversation material. You are curating
facts your future self will drop as one-line color in chats — not writing a
digest for anyone to read now.

1. Call `get_wc_notes` (limit 30) first and treat it as the dedup list: never
   save a fact that is already there in any form.
2. Get the current picture: `get_wc_schedule` for recent results and scores,
   `get_wc_odds` (view "winner") for the odds board.
3. Search the web for World Cup 2026 news from the last ~24 hours: upsets,
   records broken, star performances, hat-tricks, injuries to big names,
   dramatic endings, notable odds swings. This tournament only — skip
   transfer gossip, club football, and anything about other competitions.
4. Save at most 4 genuinely new items with `save_wc_note`. Each note is one
   or two factual sentences with teams and the UTC date, the kind of fact a
   good companion brings up ("Haaland scored twice as Norway knocked Brazil
   out 2-1 — Norway's first semifinal ever"). Facts only, sourced only — a
   note you couldn't cite doesn't get saved. The wit happens later, in
   conversation; notes stay deadpan.

If web search is unavailable, derive notes from the schedule scores and odds
moves alone. If nothing genuinely noteworthy happened, save nothing and
finish — an empty run is a correct run.
