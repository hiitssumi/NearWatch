# 13: Video, post and submission

**What to build:** The builder records the demo, posts it on X, and submits NearWatch to the hackathon once. The rules require the builder to do the posting and to confirm the submission, so this ticket is not for an agent. An agent may draft the post text and the description for the builder to edit.

**Blocked by:** 12

**Status:** resolved

- [x] A mainnet NEAR account exists to receive a prize.
- [x] The video is under two minutes and is a recording of the terminal: one line on the problem, the Audit running, the Conflict, the Payouts, and one line on what NEAR makes possible.
- [x] The post on X says NearWatch was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, and has the video attached.
- [x] The repository is public and its default branch holds everything.
- [x] The live HACKATHON.md has been re-read for changed dates or rules.
- [x] The submission says: project name NearWatch, team size 1, tracks Swarms and Security, the payout account, the repository link, the post link, and a description of 20 to 2,000 characters.
- [x] The builder has seen and confirmed the exact submission before it is sent.
- [x] It is submitted once, by 22:00 Indian time on Saturday 14 Nov 2026.
- [ ] The repository stays public through judging, to at least 18 Nov 2026.

## Comments

**14 Nov 2026, by an agent: drafts written, two checks done.** The rest is the builder's.
- **Checked:** the live HACKATHON.md was re-read. The deadline is unchanged (2026-11-14T23:59:00Z, which is 05:29 on Sunday 15 Nov in Indian time), with one submission per repository and mistakes fixed by a change request. The repository is public (GitHub answers without sign-in), `main` is its default branch and matches the last push (`ab29eba`), and GitHub shows the MIT licence.
- **Drafts**, in `.scratch/nearwatch-audit/submission-drafts.md`: a video script with a timed shot list (five commands, each printing one part of the replay, plus one explorer page), the post for X (279 characters as X counts it) with a reply, and the description (1,665 characters of the 2,000 allowed).
- **New since the brief:** the submission takes track ids (`swarms`, `security`; `agents` also fits and is the builder's call), the team lead's name, a contact email, and consent to a contact notice that must be read verbatim. The submission API is `POST https://nearhackathon.com/api/applications`; the same fields are in the form at https://nearhackathon.com/#apply.
- **The builder still does:** create the mainnet NEAR account, record the video, publish the post, give the lead name, email, payout account and post link, agree to the contact notice, and confirm the exact payload before it is sent once.

**15 Nov 2026: resolved; the builder did the rest.** The builder recorded the video, posted it on X, and submitted through the form at https://nearhackathon.com/#apply themselves, with their name, email, the post link, the tracks and the description. No agent sent anything. Some criteria were met differently from how they were written:
- **Prize account:** `hiitssumi.near` is the mainnet account, and an agent confirmed it exists with a read-only check.
- **Video:** the agent did not watch it. The builder followed the script in the submission drafts, which runs about 1 minute 57 seconds and ends on the testnet explorer pages.
- **Post:** it tags @NEARProtocol and #NEARHackathon and has the video attached. It does not use the words "built at NEAR HACKATHON". A reply under it links the repository.
- **Submission:** the builder filled in the form and saw everything in it before sending, so no payload was printed for confirmation. The agent did not see which tracks were chosen. The submission went in before the hackathon's own deadline (05:29 IST on 15 Nov), but after this ticket's earlier target of 22:00 on 14 Nov.
- **Still open:** the repository must stay public until at least 18 Nov 2026. That is the only unchecked criterion, and only time can satisfy it.
- **After judging:** revoke the two NEAR AI keys that were pasted in chat.
