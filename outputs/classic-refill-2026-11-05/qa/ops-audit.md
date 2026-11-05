# Read-only delivery audit · 5 November 2026

Checked 2026-11-05T18:38:14.951Z (Europe/Moscow). Repository zairush8877-sys/repetitor, snapshot 5965d293543504115bd0b5061667b8e096fbacf3, account @mairova_a_a. No external mutation.

- Next seven full days Nov6–12: 15/21 unique classic slots; 15/15 present entries have current draft keys, video/cover manifests and matching complete VIDEO Stories hashes. Six absent slots are Nov11/12 at10:00,14:00,19:00 Moscow. Binary/live media verification remains the parent dry-run responsibility.
- Fifteen primary voice slot objects and dates equal the variation-base source. Twelve future voice queue objects are unchanged. Voice03 now contains ordinary publication receipts and hydrated media; other fourteen voice objects equal source.
- Nov5: classic05 and06 each have independently GET-verified feed IDs and full-video Story IDs in successful job logs. Classic08 remains approved and due. No active-campaign unknown/partial delivery blockers. One historical legacy partial Story exists (2026-10-05-oge-szhatie), outside active calendar, unchanged.
- Nov4: voice03 and classic02 were released; classic03/04 remain approved on their old date. Two subsequent scheduled runs started after Moscow midnight and correctly selected Next slot Nov5 07:00Z. No catch-up performed.
- Complete Nov4–5 UTC query:8 runs total,6 publish and2 standalone-Stories, all success. Standalone Stories success means preparation only, no release; full-video Reel reposts are confirmed by publisher logs.
- Current publisher cron declares8 daily wakeups (0 and23 minutes at06/07/11/16UTC). Observed publisher starts are Nov4 14:16/14:40/21:48/21:56UTC and Nov5 14:28/14:45UTC. Why scheduled run creation is sparse/delayed is unproved. There is no failed job/token error or active delivery ambiguity in this evidence.

Refilling future media does not establish repair of scheduled delivery. Preserve dates/receipts and existing sender; do not manually republish or create a second cron.

Evidence: ops-audit.json, runs-before.json, job-*.log, campaign-feed-audited.js; all in this qa directory.
