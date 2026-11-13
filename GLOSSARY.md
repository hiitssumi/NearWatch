# NearWatch

A group of agents that audits a NEAR smart contract by attacking it, proving rules about it, and checking the two kinds of evidence against each other.

## Language

### The work

**Audit**:
One full run of every agent on one contract.
_Avoid_: Scan, job, run

**Rule**:
A statement in plain English about what the contract must always do, such as "the owner cannot take a user's funds".
_Avoid_: Invariant, requirement, check

**Property**:
A Rule written in Lean, so that it can be proved or refuted.
_Avoid_: Theorem, spec, Lean rule

**Formalization**:
A description of the contract's behaviour in Lean, written by reading the code. A proof holds for the Formalization, not for the contract itself.
_Avoid_: Model, Lean model, spec

**Rule check**:
A comparison over what was observed in the sandbox, just before and just after one contract call, that is true when a Rule has been broken. It names the calls it is about and what each observation reads.
_Avoid_: Assertion, oracle, test

**Scenario**:
The Attacker's proposed way to break a Rule: setup actions in the sandbox, then one call under test.
_Avoid_: Exploit test, attack script, test case

**Finding**:
A Scenario that the Referee has run in the sandbox and that made its Rule check true.
_Avoid_: Bug, vulnerability, issue, exploit

**Recording**:
The stored answers and outcomes of one real Audit, from which that Audit can be replayed.
_Avoid_: Fixture, snapshot, log

**Lead**:
A suspected weakness, or a Scenario that did not make its Rule check true. A Lead is never reported as a Finding.
_Avoid_: Potential finding, warning, suspicion

**Conflict**:
A Finding that breaks a Rule whose Property has a passing proof. It means the Formalization does not match the contract.
_Avoid_: Disagreement, contradiction, mismatch

**Refinement**:
A more detailed Formalization written in response to a Conflict, covering only the contract call the Finding went through. The first Formalization treats every call as one indivisible step.
_Avoid_: Fix, revision, second model

**Counterexample**:
Concrete values for which Lean confirms that a Property is false against a Formalization. After a Refinement, it is the Prover's evidence of why a Rule is broken, set beside the Attacker's Finding.
_Avoid_: Disproof, refutation, failing case

### Verdicts

Every Rule ends an Audit with exactly one verdict. A Finding always outranks a proof.

**Broken**:
A Finding against the Rule was reproduced.
_Avoid_: Failed, vulnerable, exploited

**Proven**:
The Rule's Property was proved against the Formalization, and no Finding stands against it.
_Avoid_: Verified, safe, passed

**Unproven**:
The Rule has neither a Finding against it nor a proof for it.
_Avoid_: Unknown, inconclusive, failed

### Payment

**Fee**:
The fixed amount paid for one Audit.
_Avoid_: Price, bounty, budget

**Payout**:
One agent's share of the Fee. The Attacker's and the Prover's Payouts depend on the Referee's verdicts; every other agent's Payout is flat.
_Avoid_: Reward, bounty, earnings

### The agents

**Scout**:
The agent that maps where money enters, sits and leaves the contract, and who can change the contract.

**Attacker**:
The agent that tries to break the contract in the sandbox and produces Findings and Leads.
_Avoid_: Red team, hacker

**Rules agent**:
The agent that writes the Rules, the Properties and the Formalization.

**Prover**:
The agent that tries to prove each Property against the Formalization.
_Avoid_: Verifier

**Referee**:
The agent that checks the other agents' work and detects Conflicts.
_Avoid_: Judge (reserved for the people scoring the hackathon), arbiter

**Reporter**:
The agent that writes the result of an Audit in plain English for the contract's owner.
