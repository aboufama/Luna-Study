# Independent canonical-board transition review

**16/16 checks passed.** Zero provider calls; no production edits. Exact source hashes and individual outcomes are recorded in `transition-guard-review.json`.

Reproduce from the project root:

```sh
node benchmarks/tutor-quality/review-transition-guard.mjs
```

The runner uses actual WebSocket loopback and production lifecycle code with synthetic source material and fake tutor, Jev and speech transport. It checks enforcement, not semantic classifier accuracy.

- transition missing match stays hidden.
- transition unknown match stays hidden.
- transition rejected match stays hidden.
- matching new target replaces all old blocks.
- same target structured patch retains omitted blocks.
- late match after source change never reopens.
- late match after new student turn never reopens.
- later turn cannot reopen old target after rejected transition.
- shape evidence blank matrix.
- shape evidence unlabeled scene.
- jev receives shape without visible label text.
- jev match boundary 0.9.
- jev match boundary 0.89.
- jev match boundary 0.1.
- jev match boundary null.
- confirmed departure releases pending canonical hold.

The independent review also verified the same-question patch path, historical-question identity rules and final-grant priority. The public candidate summary is bounded to 6,000 characters per text/shape field and the first 32 geometry objects; matching may abstain when that summary is insufficient. An abstention hides the proposed new-target scene. Live hint quality, model teaching quality and general semantic correctness require separate evidence.
