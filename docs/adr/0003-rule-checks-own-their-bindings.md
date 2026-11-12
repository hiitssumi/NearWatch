# A Rule check is about one call, and it owns what it reads

The first live Audits let the Attacker write a Scenario as any list of actions and choose what each observation in the Rule check reads. Two false Findings followed. One Scenario withdrew to bob but pointed the "receiver" observation at alice's wallet, so a correct withdrawal looked unpaid. Another unpaused, deposited and paused again, so "paused before and after" held while the deposit went through. The spec says the Attacker cannot fake a Finding, and both runs showed it could.

So a Scenario is now setup actions followed by exactly one call under test. "Before" is observed just before that call and "after" just after. The Rules agent writes, as part of the Rule check, which methods the Rule is about and what each observation reads, using references to the call under test (`$caller`, `$contract`, `$arg:<name>`) or a fixed account name. The Attacker chooses only the setup and the call.

We considered keeping free-form Scenarios and stating the gap as a known limit. We rejected that because a Finding has to mean a reproduced break of the Rule, not a quirk of what the Attacker chose to watch.

## Consequences

- A bug that needs two calls to interleave cannot be expressed. The harness already runs calls one after another, so nothing that worked before is lost.
- Rule checks have to name methods and bindings correctly. A Rule check that reads the wrong thing now makes Rules fail, not Findings appear.
