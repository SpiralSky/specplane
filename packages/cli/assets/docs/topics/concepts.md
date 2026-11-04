# Specifications, decisions and optional plans

Feature specifications describe intended behavior. Architecture specifications describe how the system meets it. Root-qualified identifiers distinguish base requirements from extension overlays. Configuration chooses specification roots and the plans directory.

Review approval is a human decision. An implementation declaration does not approve a specification, finish a plan, or prove tests passed. Contribution provenance records authorship separately from permission.

Authorship policy applies to ordinary work as well as managed workflows. Under `review`, a model can suggest changes and apply an exact user-approved edit. Under `assist`, content must be finalized and its text approved before writing. Under `draft`, a model can draft for review. Under `none`, a model can read and implement requirements but cannot edit, review or suggest body changes.

Plans are optional coordination records. Ordinary code changes can use arbitrary branches and ordinary commits. Managed execution uses its designated plan checkout and records one step at a time. Human approval gates remain separate from execution.
