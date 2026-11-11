# 12: README and licence

**What to build:** A README that a hackathon reviewer, human or AI, can follow step by step to see each claimed feature, and that states plainly what is planted, what is real, and what a proof covers. Plus the licence file.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] The README opens with what NearWatch is in two or three sentences. No marketing.
- [ ] It is written as "do X, see Y" steps for: plain replay on a bare machine, the vault tests, a live Audit, and replay with verification if ticket 15 is done.
- [ ] Near the top it states: the demo vault was written for this project and its bug was planted.
- [ ] Near the top it states: the Attacker is given a list of known bug classes, but not the bug's location.
- [ ] Near the top it states: a proof covers the Formalization, not the contract's code.
- [ ] Near the top it states: results are promised for the demo vault only.
- [ ] It states that NearWatch is independent, is not affiliated with NEAR AI, and is not a rival to NEAR's own security work.
- [ ] It lists the libraries and tools used, and says the code was written with AI coding agents.
- [ ] It lists the three known limits from the spec's "Further Notes".
- [ ] It makes the four claims about NEAR from the brief and no others. It makes no claim of private or confidential inference.
- [ ] It names payment through NEAR Intents as a next step.
- [ ] It explains why the first Formalization is coarse, pointing to `docs/adr/0001`.
- [ ] If ticket 18 replaced 07, it says "checked, not proven" wherever it would have said proved.
- [ ] An MIT LICENSE file is present.
- [ ] The example settings file is present with names only, and the real settings file is ignored by git.
- [ ] Every command in the README has been run from a fresh clone and prints what the README says it prints.
