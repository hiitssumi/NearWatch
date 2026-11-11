-- TEST MATERIAL ONLY. Hand-written first Formalization of the demo vault (every call is one step,
-- docs/adr/0001). It never ships as an Audit's evidence. Plain Lean 4, no packages, no Mathlib.

abbrev Account := String

structure State where
  balance   : Account → Nat
  deposited : Account → Nat
  received  : Account → Nat  -- total paid out on this account's behalf
  owner     : Account
  paused    : Bool

inductive Call where
  | deposit   (caller : Account) (amount : Nat)
  | withdraw  (caller : Account) (receiver : Account) (amount : Nat)
  | setPaused (caller : Account) (p : Bool)

def Call.caller : Call → Account
  | .deposit c _ => c
  | .withdraw c _ _ => c
  | .setPaused c _ => c

def bump (f : Account → Nat) (who : Account) (d : Nat) : Account → Nat :=
  fun a => if a = who then f a + d else f a

def drop (f : Account → Nat) (who : Account) (d : Nat) : Account → Nat :=
  fun a => if a = who then f a - d else f a

def step (s : State) : Call → State
  | .deposit c amt =>
      if s.paused then s
      else { s with balance := bump s.balance c amt, deposited := bump s.deposited c amt }
  | .withdraw c _ amt =>
      if amt ≤ s.balance c then
        { s with balance := drop s.balance c amt, received := bump s.received c amt }
      else s
  | .setPaused c p => if c = s.owner then { s with paused := p } else s
