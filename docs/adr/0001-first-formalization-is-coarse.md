# The first Formalization is deliberately coarse

The first Formalization of a contract treats every contract call as one indivisible step, even where the code is asynchronous. It is made more detailed only by a Refinement, which happens only after the Referee reports a Conflict, and only for the call the Finding went through. We chose this because proofs against a coarse Formalization are cheap enough to attempt at all, and because it gives the Attacker and the Prover a real way to disagree: a Finding on the real contract is the evidence that tells us where the Formalization is too simple.

## Considered Options

- **Let the Rules agent write the most faithful Formalization it can.** Rejected: proofs become much harder, and how detailed the Formalization is would vary from one Audit to the next with no reason anyone could point to.
- **Write the Formalization by hand.** Rejected: it would not be the agents' work, and it does not extend to a second contract.

## Consequences

- A Proven verdict means "proved for the Formalization at its current level of detail". The report must say so.
- A coarse Formalization will pass proofs that are false of the real contract. This is expected. The Attacker and the Referee exist to catch those cases, so a Finding always outranks a proof.
