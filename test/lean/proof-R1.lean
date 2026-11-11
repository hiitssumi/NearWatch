intro s c a
cases c with
| deposit c amt =>
  by_cases hp : s.paused = true
  · simp [step, hp]
  · by_cases h : a = c
    · subst h; simp [step, hp, bump]
    · simp [step, hp, bump, h]
| withdraw c r amt =>
  by_cases hb : amt ≤ s.balance c
  · by_cases h : a = c
    · subst h; simp [step, hb, bump, drop]; omega
    · simp [step, hb, bump, drop, h]
  · simp [step, hb]
| setPaused c p =>
  by_cases ho : c = s.owner <;> simp [step, ho]
