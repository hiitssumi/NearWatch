intro s c a
cases c <;> simp only [step] <;> (repeat' split) <;> simp_all [bump, drop] <;> (repeat' split) <;> omega
