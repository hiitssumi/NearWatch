∀ (s : State) (c : Call) (a : Account), c.caller = s.owner → a ≠ s.owner → s.balance a ≤ (step s c).balance a
