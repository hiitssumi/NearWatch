intro s c a hc ha
cases c <;> simp only [step] <;> (repeat' split) <;> simp_all [bump, drop, Call.caller] <;> (repeat' split) <;> omega
