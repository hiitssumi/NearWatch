-- TEST MATERIAL ONLY. Hand-written Refinement of the demo vault's first Formalization (vault-first.lean):
-- withdraw is split into a start step and a resolve step with a success and a failure branch, as a
-- Refinement does after a Conflict (docs/adr/0001). It never ships as an Audit's evidence.
-- Plain Lean 4, no packages, no Mathlib.

abbrev Account := String

structure Pending where
  caller   : Account
  receiver : Account
  amount   : Nat

structure State where
  balance   : Account → Nat
  deposited : Account → Nat
  received  : Account → Nat  -- total paid out on this account's behalf
  owner     : Account
  paused    : Bool
  pending   : List Pending   -- transfers withdraw has scheduled that have not yet landed or failed

inductive Call where
  | deposit         (caller : Account) (amount : Nat)
  | withdrawStart   (caller : Account) (receiver : Account) (amount : Nat)
  | withdrawResolve (ok : Bool)
  | setPaused       (caller : Account) (p : Bool)

def Call.caller : Call → Account
  | .deposit c _ => c
  | .withdrawStart c _ _ => c
  | .withdrawResolve _ => ""
  | .setPaused c _ => c

def bump (f : Account → Nat) (who : Account) (d : Nat) : Account → Nat :=
  fun a => if a = who then f a + d else f a

def drop (f : Account → Nat) (who : Account) (d : Nat) : Account → Nat :=
  fun a => if a = who then f a - d else f a

def step (s : State) : Call → State
  | .deposit c amt =>
      if s.paused then s
      else { s with balance := bump s.balance c amt, deposited := bump s.deposited c amt }
  | .withdrawStart c r amt =>
      if amt ≤ s.balance c then
        { s with balance := drop s.balance c amt, pending := s.pending ++ [⟨c, r, amt⟩] }
      else s
  | .withdrawResolve ok =>
      match s.pending with
      | [] => s
      | p :: rest =>
          if ok then { s with received := bump s.received p.caller p.amount, pending := rest }
          -- The contract has no callback: when the transfer fails, nothing restores the balance.
          else { s with pending := rest }
  | .setPaused c p => if c = s.owner then { s with paused := p } else s
