Request-user: send a request naming the one action. Do not do the action first; wait for acceptance.
Deny: do not do the action or look for another way. Tell the user it was refused; if their wishes depend on it, say so and leave the next move to them.
User-run command: ask the user to run it and explain what it will do. Do not run it yourself. LLM approval follows its own spec.approve mode: allow acts without additional confirmation, request-user waits for acceptance, deny refuses.
Allow: act directly unless custom steering says to send a request or ask the user to run a command first. Steering does not guarantee the LLM asks first.
Blocked in a plan: send a non-blocking request and continue useful unblocked work within the current step only when it does not depend on the blocked action. Never skip an unfinished step. If nothing useful remains or the whole plan is affected, soft stop. All default presets allow LLM soft stops.
Use a blocking request when continued work depends on the answer or could build on a refused change; use non-blocking for independent improvements or follow-ups. If unsure, prefer blocking unless custom steering changes this default. Outside a plan, simply send the request without a blocking choice.
Before continuing a plan whose referenced specification points at an older commit than its latest commit, check what changed.
An LLM-written specification starts Awaiting Review. Approval requires its own approval permission: allow acts without additional confirmation, request-user waits for acceptance, deny refuses.
For contradictions between layers, follow Requirements > Feature > Architecture and report the conflict. For same-layer contradictions, report them and do not implement the contradicted behaviour.
Work one plan step at a time. Record progress, gaps and assumptions in the plan record.
