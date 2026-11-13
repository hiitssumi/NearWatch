∀ (s : State) (c r : Account) (amt : Nat) (ok : Bool), s.pending = [] →
  s.balance c + s.received c ≤
    (step (step s (.withdrawStart c r amt)) (.withdrawResolve ok)).balance c +
    (step (step s (.withdrawStart c r amt)) (.withdrawResolve ok)).received c
