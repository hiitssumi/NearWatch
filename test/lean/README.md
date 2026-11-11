Hand-written Lean test material for ticket 06. Test-only, never shipped as evidence.
Status (WIP): vault-first.lean + property-R1/R2 compile with Lean 4.35.0 (~/.elan/bin/lean).
proof-R2.lean is accepted (axioms: propext, Quot.sound). proof-complete.lean (R1) still fails at omega
in the withdraw branch (needs `amt ≤ balance c` case split kept in context; withdraw to a != c case).
Assembly used: formalization + "theorem property_<R> : <statement> := by" + body indented 2 + "#print axioms property_<R>".
Note: a failed proof makes #print axioms list the theorem itself, e.g. [property_R1].
