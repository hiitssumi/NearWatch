∀ (s : State) (c : Call) (a : Account), s.balance a + s.received a ≤ (step s c).balance a + (step s c).received a
