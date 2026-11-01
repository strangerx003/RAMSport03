# FTA Analysis Procedure — IEC 61025:2006

**Build-and-perform specification for an AI agent or developer.**

This document is the complete working procedure for performing a Fault Tree Analysis to IEC 61025:2006 (2nd edition) and for building a tool that automates it. It assumes the system description, hazard analysis/FMECA and reliability data already exist. Follow the steps in order. Implement the algorithms in §7–§11 for software. Use §14 as the acceptance test suite.

Everything here is derived from IEC 61025:2006; clause references are given so each rule can be verified against the standard.

---

## 1. Deliverables

A compliant analysis produces:

1. **One top event** — single, unambiguous, with a stated failure criterion and mission time.
2. **A fault tree** — events and gates per the standard's symbol set, uniquely labelled.
3. **Minimal cut sets** — the qualitative result (Method A), with single-point failures flagged.
4. **A quantified top-event probability** — with the calculation method and validity statement (Method B), plus cut-set ranking.
5. **Assumptions and limitations** — design, operation/maintenance, modelling.
6. **An FTA report** — Clause 9 minimum content (§16).
7. **Traceability** — every event tied to design documentation, FMECA line, hazard ID and data source.

Roles: FTA analyst (system knowledge + FTA training), independent reviewer (design engineer), data owner (reliability data).

---

## 2. Inputs required before starting

Collect and record all of the following (Clause 6.2). If an item is genuinely not applicable, record "N/A" with a justification — do not leave it blank.

| Input | Why it is needed |
|---|---|
| Design intent and functional description | Defines what the system is supposed to do |
| Failure definition and success criteria | Fixes what counts as the top event |
| Functional structure / block diagrams | Basis for cause paths |
| Physical structure / schematics / drawings | Basis for component-level events |
| System boundaries and interfaces | Stops the tree at the right place |
| Operational modes and profile | Different modes produce different trees/gates |
| Mission time / demand profile | Converts rates to probabilities |
| Environment (temperature, vibration, EMC, humidity) | Secondary/induced failures |
| Human factors and operating procedures | Human-error basic events |
| Test intervals and maintenance regime | Dormant-failure probability |
| Repair times and logistics | Repairable/monitored unavailability |
| Reliability data sources | Basic-event probabilities, with provenance |
| Applicable standards and documents | Traceability |
| Prior hazard analysis / FMECA | Completeness cross-check |

---

## 3. Data model (what the tool must store)

### 3.1 Analysis project

`project_id, system_id, standard_version, analyst, reviewer, status, created/updated`

### 3.2 Analysis (one tree)

`analysis_id, top_event_id, objective, scope, boundaries_in, boundaries_out, resolution_level, mission_time, operational_modes, assumptions[], status`

### 3.3 Event

| Field | Values / notes |
|---|---|
| `event_id` | Unique hierarchical label (§5.3) |
| `event_type` | basic / undeveloped / conditional / dormant / house / intermediate / zero |
| `description` | **What** fails, **when**, under **which conditions** |
| `parent_gate` | Gate consuming this event |
| `probability` | Numeric value (if basic/undeveloped) |
| `probability_type` | `p` (per demand) / `lambda` (per hour) / `lambda+T` / `lambda+T+T_R` / distribution |
| `data_source` | Document/reference + applicability statement |
| `fmeca_ref`, `hazard_ref` | Traceability |
| `ccf_group` | Common-cause group ID, if any |

### 3.4 Gate

| Field | Values |
|---|---|
| `gate_id` | Unique |
| `gate_type` | OR / AND / VOTE / XOR / NOT / NOR / NAND / INHIBIT / PAND / SEQ / SPARE |
| `inputs[]` | Ordered list of child event/gate IDs (order matters for PAND/SEQ) |
| `output_event` | Intermediate event ID |
| `vote_m` | For VOTE: minimum number of failed inputs that produces the output |
| `condition` | For INHIBIT/PAND: conditional event ID |
| `spare_type` | For SPARE: cold / warm / hot |

### 3.5 Supporting records

- **Data record:** event ID, value, unit, source, applicability, review status.
- **Label register:** event ID ↔ design document ↔ FMECA line ↔ hazard ID.
- **Result:** cut sets, `Q_top`, method used, validity statement, ranking, sensitivity.
- **CCF record:** group members, beta factor, justification.

### 3.6 Hard tree constraints

- Exactly **one** top event per tree.
- Every event has exactly one parent (except the top event); repeated events are **references to the same ID**, not copies.
- No gate output connected directly to another gate — an intermediate event box is always required.
- Every gate has ≥ 2 meaningful inputs (a single-input OR may be used only as an explicit pass-through).
- No isolated events; no unlabelled branches; no duplicate IDs for different events.

---

## 4. Procedure — step by step

### Phase 0 — Frame the analysis

**Step 1 — Create the analysis record.**
Enter objective, scope, boundaries (in/out), system description, failure definition, operational modes, operational profile, mission time, maintenance/test interval `T`, repair time `T_R`, environment, human-factors model, assumptions.

*Gate: do not start tree construction until every §2 input is recorded or justified N/A.*

**Step 2 — Define the top event.**
Write it as a precise statement of **what fails, when, and under which conditions**. Examples:
- Safety: "Signal shows PROCEED while the route is locked for a conflicting movement."
- Reliability: "System cannot deliver function X in operating mode Y for the duration of the mission."

Exactly one top event per tree. If you need several, create several analyses.

**Step 3 — Set the resolution level.**
Choose component / assembly / subsystem level. It must match the granularity of the available probability data. The tool must flag any basic event whose granularity disagrees with the recorded resolution.

**Step 4 — Mark the review checkpoint.**
Status becomes `constructed pending review`. Clause 6.1 requires design-team review of the finished tree before quantification is issued.

### Phase 1 — Construct the tree

**Step 5 — Build top-down using the immediate-cause concept.**
For each event box:

1. Ask: *"Can this fault consist of a component failure?"*
   - **Yes** → insert an OR gate and generate the three standard children:
     - **primary fault** — failure within the design envelope;
     - **secondary fault** — failure caused by an unqualified environment;
     - **command fault** — correct function at the wrong time.
     Keep or remove unused branches with justification.
   - **No** → add the minimum immediate, necessary and sufficient causes through the appropriate gate(s).
2. Develop **one level at a time**; complete a gate before developing its children.
3. Stop a branch when:
   - a **basic event** is reached (probability data available), or
   - an **undeveloped event** is justified (e.g. COTS with no data), or
   - the tree continues on another page — use a **transfer out/in** with the identical label.

**Immediate cause, not root cause.** The input to a gate is the mechanism or failure mode that directly produces the output event. Do not jump to organisational or root causes.

**Step 6 — Select the gate by logic, not by habit.**

| Situation | Gate | IEC basis |
|---|---|---|
| Several independent causes, each sufficient alone | OR | Annex A.3 |
| Redundant elements — failure requires all to fail | AND | Annex A.3 |
| Voting architecture (e.g. 2oo3 computer) — output fails when `m = n − k + 1` of `n` channels fail, `k` being the number that must remain operational | VOTE | Annex A.3 |
| Occurrence conditional on a circumstance | INHIBIT | Annex A.3 |
| Order of occurrence matters | PAND / SEQ | Annex A.4 |
| Standby redundancy | SPARE | Annex A.4 |
| Exactly one of two | XOR | Annex A.3 (restricted) |
| Complement logic | NOT / NOR / NAND (restricted) | Annex A.3 |
| Load sharing / shared environment | do **not** model as plain AND — apply CCF (§11) or a dynamic gate | 7.5.2.4 |

**Step 7 — Label every event.**
Format: `hierarchical code + component + failure mode`, e.g. `PM1_CONTACTS_CLOSED_T>60S`, `Short_C132`, `Open_R34`.
- Repeated or common-cause events must carry the **identical** label.
- Different failure modes of the same item must be distinguishable.
- Every new label is written to the label register with its document/FMECA/hazard references.

**Step 8 — Run consistency checks before evaluation.**
- **Event/state rule:** if a gate output is an *event*, all its inputs must be events; if the output is a *state*, inputs are states.
- **Complete the gate:** every way the output can occur is represented.
- No gate-to-gate links; no "miracles" (events that vanish); no missing branches.
- Replicated events and common-cause candidates identified (same environment, batch, power supply, software, maintenance team).

### Phase 2 — Qualitative evaluation

**Step 9 — Structural validation.**
- One top event; all events labelled; repeated events share IDs; no duplicate labels.
- Each gate fully defined before its children were developed.
- No isolated events or dangling gates.
- Resolution consistent with the recorded level.

**Step 10 — Boolean reduction to minimal cut sets.**
1. Write one Boolean equation per gate (`OR = +`, `AND = ·`).
2. Substitute top-down and expand using the distributive law.
3. After every expansion apply:
   - idempotence: `X·X = X`
   - absorption: `A + A·B = A`
   - (optionally) consensus: `A·B + A'·C + B·C = A·B + A'·C`
4. The result is `T = M1 + M2 + …` in minimal product terms — the **minimal cut sets**.
5. Sort by order (number of basic events). Every **order-1 cut set is a single-point failure** — flag it for design justification and FMECA cross-check.

*Cut sets are only strictly meaningful for static gates. If the tree contains dynamic gates and sequencing is ignored, the result is an approximation and must be stated as such.*

**Step 11 — Common-cause screen.**
Group cut-set members that share a credible common cause (same component type, location, environment, test interval, maintainer, power source, software). For each group:
- add a **CCF basic event** in parallel with the independent failure paths;
- split the failure probability using the beta-factor model (§11);
- record the group and its justification.

**Step 12 — FMEA/FMECA cross-check.**
- Every FMECA single failure that reaches the top event must appear as an order-1 cut set.
- Every order-1 cut set must exist in the FMECA.
- Any mismatch is an open finding: one of the two analyses missed an event.

### Phase 3 — Quantitative evaluation

**Step 13 — Attach data and convert to probabilities.**
For every basic/undeveloped event record value, unit, source and applicability. Convert all rates to probabilities **before** combining (§6). The tool must refuse to quantify until every basic event has `q` with provenance.

**Step 14 — Quantify cut sets.**
`Q_j = ∏_{i∈C_j} q_i` assuming independent basic events. If independence is broken by a CCF, the tree must already contain the CCF branch from Step 11.

**Step 15 — Combine cut sets to the top event.**
Compute all three and report a validity statement (§8):
- rare-event upper bound: `Q_top ≤ Σ Q_j`;
- Esary–Proschan: `Q_top ≈ 1 − ∏(1−Q_j)`;
- exact: disjointing (Annex B), inclusion–exclusion, or BDD.

If the rare-event sum exceeds 1, the bound is invalid — use an exact method.

**Step 16 — Dynamic gates.**
Route PAND/SEQ/SPARE to a Markov solver or simulator (§9). Insert the computed probability back as **one basic event**, recording the Markov model reference. Do not enumerate cut sets through dynamic branches unless the analyst explicitly accepts an order-ignoring approximation.

**Step 17 — Rank and interpret.**
- Cut-set share: `F_j = Q_j / Q_top` — the Pareto ranking.
- Basic-event importance (§12): Fussell–Vesely and Birnbaum.
- Identify dominant contributors, single-point failures and design weaknesses.
- Compare against requirements and against design alternatives.

**Step 18 — Sensitivity.**
Vary each `q` by factors (×2, ×0.5, ×10) and remove dominant order-1 cut sets as design "what-if" cases. Output a tornado chart and the design questions answered (e.g. "does duplicating component X remove the dominant cut set?").

### Phase 4 — Report and review

**Step 19 — Generate the report** (§16, Clause 9 minimum content).

**Step 20 — Review loop.**
Route to the design-team reviewer (Clause 6.1). Status transitions: `Draft → Constructed → Reviewed → Quantified → Issued`. Record corrective actions and track them to closure. Re-run the analysis whenever the design changes.

---

## 5. Event symbols and gate catalogue

### 5.1 Event symbols

| Symbol | Meaning |
|---|---|
| Circle | **Basic event** — lowest level, probability data available |
| Diamond | **Undeveloped event** — no further development possible/needed (e.g. COTS) |
| Rectangle | **Intermediate event** — output of a gate |
| Ellipse/oval | **Conditional event** — condition used with INHIBIT or PAND |
| Dormant event symbol | **Dormant/latent event** — detectable only by test or inspection |
| House | **House event** — TRUE/FALSE switch; user controls branch inclusion |
| Transfer in / out | Tree continues on another page; labels must match exactly |
| Zero event | Event that cannot occur |

### 5.2 Static gates — formulas (independent inputs)

Let `F_i` be the probability that input `i` occurs (fails). Let `F` be the gate output probability.

| Gate | Output occurs when | Formula |
|---|---|---|
| **OR** | at least one input occurs | `F = 1 − ∏_{i=1..n} (1 − F_i)` |
| **AND** | all inputs occur | `F = ∏_{i=1..n} F_i` |
| **VOTE (m-of-n)** | at least `m` of `n` inputs occur | see §5.4 |
| **NOT** | input does not occur | `F = 1 − F_1` |
| **XOR** | exactly one of two inputs occurs | `F = F_1 + F_2 − 2·F_1·F_2` |
| **NOR** | none of the inputs occurs | `F = ∏_{i=1..n} (1 − F_i)` |
| **NAND** | not all inputs occur | `F = 1 − ∏_{i=1..n} F_i` |
| **INHIBIT** | input occurs **and** the enabling condition is true | `F = P(input) · P(condition)` |

Notes:
- OR corresponds to series reliability logic; AND corresponds to parallel redundancy.
- `NOT`, `NOR`, `NAND`, `XOR` are restricted — the standard advises experienced analysts and warns about misinterpretation. A tool should require a qualification flag before enabling them.
- `INHIBIT`: the condition is a *conditional event*, not a failure path. If the condition is deterministic (house event TRUE), the factor is 1.

### 5.3 Voting gate — exact formulas

**Definition:** gate output (failure) occurs when at least `m` of `n` inputs fail.

Identical inputs, each with failure probability `F`:

```
F_gate = Σ_{i=m}^{n} C(n,i) · F^i · (1 − F)^(n−i)
```

Non-identical inputs `F_1 … F_n` (Poisson-binomial — the general correct form):

```
F_gate = Σ over all subsets S with |S| ≥ m of
         [ ∏_{i∈S} F_i · ∏_{j∉S} (1 − F_j) ]
```

Naming care: in a **"3-of-6" vote**, 3 channels must remain operational, so failure occurs when **4** fail → use `m = 4`. General conversion when the architecture is stated as "`k`-out-of-`n` must work":

```
m = n − k + 1        (m = number of failures that produce the gate output)
```

Common cases:

```
2oo3:  F = 3F²(1−F) + F³ = 3F² − 2F³      (≈ 3F² for small F)
1oo2:  F = 1 − (1−F)² = 2F − F²            (same as OR)
2oo2:  F = F²                              (same as AND)
```

### 5.4 Dynamic gates — output depends on input order

These cannot be evaluated with static formulas. Use Markov analysis (IEC 61165) or simulation, then replace the gate by one basic event carrying the computed probability.

| Gate | Behaviour | Quantification |
|---|---|---|
| **PAND** (priority AND) | output only if the inputs occur in a defined sequence (left → right) | Markov; see §9.1. With more than 2 inputs it is effectively a SEQ gate. |
| **SEQ** (sequential) | chain of failures in a required order, > 2 inputs | Markov chain / simulation (§9.2) |
| **SPARE** | standby redundancy — cold, warm or hot | §9.3 |

**Critical rule:** do not quantify a dynamic gate as if it were static. The sequence is the entire point, and the static result is optimistic and wrong.

### 5.5 Independence and repeated events

All static gate formulas assume **independent** inputs. If the same event appears in more than one branch (replicated event), applying AND/OR formulas directly overcounts. Reduce the tree to minimal cut sets first, then combine cut sets with an exact method (§8).

---

## 6. Basic-event probability models

Convert everything to a probability before combining. Use `λ` = failure rate (per hour), `t` = mission time, `T` = test interval, `T_R` = repair time, `p` = per-demand failure probability, `n` = number of demands.

| Component situation | Probability |
|---|---|
| Continuous operation, non-repairable, exponential | `q = 1 − e^(−λt)`; for `λt ≤ 0.1`, `q ≈ λt` |
| Repairable, continuously monitored | `q = λT_R / (1 + λT_R) ≈ λT_R` |
| Periodically tested (interval `T`), repair time `T_R` | `q ≈ λT/2 + λT_R` |
| Dormant failure, test interval `T` | `q ≈ λT/2` (average unavailability) |
| Per demand, `n` demands | `q = 1 − (1−p)^n ≈ np` for `np ≤ 0.1` |

Rules:
- Never mix rates and probabilities in the same gate.
- For a repairable system with non-negligible repair time, the FTA of IEC 61025 is limited to steady-state, independent-repair forms (Clause 7.6). Dynamic availability belongs to IEC 61165.
- Data provenance is mandatory: source, applicability statement, review status.

---

## 7. Minimal cut set algorithms

### 7.1 Top-down MOCUS

```
Start: row list = [[top gate]]
Repeat until all entries are basic events:
  For each row containing a gate G:
    If G is OR:  replace the row by one row per input of G
    If G is AND: replace the row by the cartesian product
                 (G's inputs appended to the row)
  After each pass: remove supersets (absorption)
Result: rows = cut sets; remove any row that is a superset of another
```

### 7.2 Bottom-up

```
For each gate, compute its cut sets from its inputs:
  OR:  union of input cut-set lists
  AND: cartesian product of input cut-set lists
  VOTE/NOT/XOR/NOR/NAND: convert to equivalent Boolean form first
After each combination: apply idempotence and absorption
```

### 7.3 Boolean simplification rules

```
Idempotence:        X · X = X          X + X = X
Absorption:         A + A·B = A        A · (A + B) = A
Distributive:       A·(B + C) = A·B + A·C
De Morgan:          (A·B)' = A' + B'   (A + B)' = A'·B'
Consensus (opt.):   A·B + A'·C + B·C = A·B + A'·C
```

### 7.4 Truncation (large trees)

For trees with thousands of cut sets:
- discard cut sets whose probability is below a stated cut-off;
- report the cut-off and the residual (omitted) probability bound;
- never silently truncate — the report must disclose it.

### 7.5 Complexity note

MOCUS is exponential in the worst case. For large trees use a BDD/ZBDD engine, which also gives exact probabilities and importances without truncation error.

---

## 8. Top-event probability from cut sets

For minimal cut sets `C_1 … C_k`, with independent basic events:

```
Q_j = ∏_{i ∈ C_j} q_i
```

### 8.1 Rare-event upper bound (default, conservative)

```
Q_top ≤ Σ_{j=1..k} Q_j
```
Valid only when all `Q_j` are small (rule of thumb: `Σ Q_j ≤ 0.1`). If the sum exceeds 1, the bound is invalid — reject it and use an exact method.

### 8.2 Esary–Proschan approximation

```
Q_top ≈ 1 − ∏_{j=1..k} (1 − Q_j)
```
Exact only when the cut sets are independent/disjoint; otherwise a useful approximation. Still can exceed the exact value.

### 8.3 Exact — disjointing (IEC 61025 Annex B)

Make each cut set disjoint from all preceding terms using relative complements, then add:

1. Order the cut sets `C_1 … C_k`.
2. For `j > 1`, replace `C_j` by `C_j ∩ (C_1 ∪ … ∪ C_{j−1})'`.
3. Expand complements with De Morgan: `(A ∪ B)' = A' ∩ B'`.
4. Expand each term into disjoint products using `X = X·(Y + Y')`.
5. Drop non-minimal/duplicate products.
6. `Q_top = Σ` of the probabilities of the disjoint products.

Term order changes the intermediate form but not the final value.

### 8.4 Exact — inclusion–exclusion

```
Q_top = Σ Q_j
        − Σ_{j<l} P(C_j ∩ C_l)
        + Σ_{j<l<m} P(C_j ∩ C_l ∩ C_m)
        − …
```
`P(C_j ∩ C_l) = ∏ q_i` over the union of the two cut sets.

### 8.5 Exact — BDD

Build a binary decision diagram of the Boolean tree, then compute the probability by traversing it. Exact, no truncation, and supports exact importances. Recommended for large trees.

---

## 9. Dynamic gate quantification

### 9.1 PAND (priority AND)

Two exponential inputs A (rate `λ_A`) and B (rate `λ_B`), mission time `T`. The output occurs if A occurs first, then B, both within `T`:

```
P = ∫₀^T λ_A e^(−λ_A t) · [1 − e^(−λ_B (T−t))] dt
```

Identical rates `λ_A = λ_B = λ`:

```
P = 1 − e^(−λT) − λT·e^(−λT)
```

For more than 2 inputs, use a Markov chain (SEQ).

### 9.2 SEQ (sequential)

Model the required order as a Markov chain with states representing how many stages have occurred. Solve for the probability of reaching the final state within `T` (transient solution). For non-exponential distributions, use simulation.

### 9.3 SPARE (standby redundancy)

**Cold standby**, `n` identical units, perfect switching, rate `λ` — system fails when all `n` have failed:

```
F(t) = 1 − e^(−λt) · Σ_{k=0}^{n−1} (λt)^k / k!
```
(the failure time is Erlang-`n`).

- `n = 1`: `F = 1 − e^(−λt)` (ordinary exponential).
- `n = 2`: `F = 1 − e^(−λt)(1 + λt)`.

**Hot standby** — all units powered; behaves as parallel redundancy:
```
F = F_unit^n
```

**Warm standby** — different failure rates active/standby; use a Markov chain.

---

## 10. Dormant failures and test intervals

A dormant (latent) failure only becomes evident at test or demand. Its probability depends on the **test interval**, not just the failure rate.

For a failure rate `λ` and periodic test interval `T`, the average unavailability is:

```
q_dormant ≈ λT / 2
```

If repair takes `T_R` and the item is unavailable after detection until repaired:

```
q ≈ λT/2 + λT_R
```

Rules:
- Record `T` and `T_R` for every dormant event.
- If the test interval is not defined, the event cannot be quantified — mark it undeveloped and justify.
- Two redundant channels with the same test interval are **not** independent for dormant failures — include them in the CCF screen.

---

## 11. Common-cause failure (CCF)

The beta-factor model is the minimum acceptable treatment:

```
Q_total = Q_independent + Q_CCF
Q_CCF   = β · Q_total
Q_ind    = (1 − β) · Q_total
```

For a redundant group of `n` identical channels, each with failure probability `q`:

```
Q_group ≈ β·q + (1−β)^n · q^n
```

Implementation rules:
- Identify CCF groups from shared attributes: same type, manufacturer/batch, location, environment, test interval, maintainer, power supply, software, installation crew.
- Add one CCF basic event per group, in parallel with the independent paths.
- Record `β`, its source and the justification for the grouping.
- Never multiply identical redundant probabilities without a CCF term.

---

## 12. Importance and sensitivity

IEC 61025 does **not** define formal importance measures. If they are required, use the conventional definitions (and cite the source, e.g. IEC 60300-3-1 or NUREG-0492):

**Fussell–Vesely (fraction of top-event probability involving event `i`):**
```
I_FV(i) = P( ∪ cut sets containing i ) / Q_top
```

**Birnbaum (rate of change of top-event probability):**
```
I_B(i) = ∂Q_top/∂q_i = P(top | i failed) − P(top | i working)
```

**Risk Achievement Worth (optional):**
```
RAW(i) = P(top | i failed) / Q_top
```

**Sensitivity:** vary each `q_i` by ×0.5, ×2, ×10 and recompute `Q_top`; rank by change. Also run design "what-if" cases (remove an order-1 cut set, duplicate a component).

Report the measures as an extension, not as an IEC 61025 requirement.

---

## 13. Software implementation requirements

### 13.1 Core modules

1. **Model store** — events, gates, references, data records, label register.
2. **Validator** — structural, labelling, event/state, resolution, data completeness.
3. **Cut-set engine** — MOCUS/bottom-up + absorption + truncation; or BDD.
4. **Quantifier** — static gate formulas, cut-set combination, exact/approx methods.
5. **Dynamic solver** — PAND/SEQ/SPARE via Markov or simulation.
6. **CCF processor** — grouping, beta-factor expansion.
7. **Importance/sensitivity** — FV, Birnbaum, tornado.
8. **Reporter** — Clause 9 report + cut-set table + graph export.

### 13.2 Data structures

```text
Node = { id, type: EVENT|GATE, eventType?, gateType?, inputs[], vote_m?, condition?, spareType? }
Event = { id, description, eventType, q, qType, source, fmecaRef, hazardRef, ccfGroup }
Tree  = { topEventId, nodes: Map<id, Node>, resolution, missionTime }
Result = { cutSets: [{ events: [id], probability }], qTop, method, valid, importance[] }
```

### 13.3 Numerical requirements

- Use log-space products for long cut sets to avoid underflow.
- Keep full precision internally; round only for display.
- Detect and reject `Q_top > 1`.
- Deterministic output: canonical ordering of cut sets (by order, then lexicographic).
- Unit-aware arithmetic: per-hour vs per-demand must never be mixed silently.

### 13.4 Graph export

Support at least one of: Graphviz DOT, Mermaid, SVG. Gate shapes and event symbols must follow the standard's symbol set.

### 13.5 Status model

`Draft → Constructed → Reviewed → Quantified → Issued`, with the validator as an enforced gate before `Issued`.

---

## 14. Acceptance tests (tool validation)

Use these exact cases. A compliant engine must reproduce every value.

### 14.1 Static gates, two inputs each `q = 0.1`

| Test | Gate | Expected |
|---|---|---|
| T1 | OR | `1 − 0.9² = 0.19` |
| T2 | AND | `0.1² = 0.01` |
| T3 | 2oo3 | `3(0.1)² − 2(0.1)³ = 0.028` |
| T4 | XOR | `0.1 + 0.1 − 2(0.01) = 0.18` |
| T5 | NOR | `0.9² = 0.81` |
| T6 | NAND | `1 − 0.01 = 0.99` |
| T7 | INHIBIT (input 0.1, condition 0.5) | `0.05` |

### 14.2 Bridge network (clause 7.5.5)

Basic events `a, b, c, d, e`, each `q = 0.1`. Minimal cut sets:

```
{ab}, {cd}, {aed}, {bec}
```

Expected values:

| Method | Value |
|---|---|
| Cut-set probabilities | 0.01, 0.01, 0.001, 0.001 |
| Rare-event sum (upper bound) | **0.022** |
| Esary–Proschan | **0.021859** |
| Exact (disjointing/inclusion–exclusion) | **0.021520** |

The engine must:
- produce exactly the four minimal cut sets;
- reject an invalid rare-event result if it exceeds 1;
- show `sum ≥ EP ≥ exact`.

### 14.3 Dynamic gates (identical rate `λT = 0.1`)

| Test | Gate | Expected |
|---|---|---|
| T8 | PAND (A then B) | `1 − e^(−0.1) − 0.1·e^(−0.1) = 0.004679` |
| T9 | SPARE, cold, 2 units | `1 − e^(−0.1)(1 + 0.1) = 0.004679` |
| T10 | SPARE, hot, 2 units | `(1 − e^(−0.1))² = 0.009056` |

### 14.4 Dormant/tests

| Test | Case | Expected |
|---|---|---|
| T11 | `λ = 1e−6/h`, `T = 8760 h`, no repair time | `q ≈ 4.38e−3` |
| T12 | same plus `T_R = 8 h` | `q ≈ 4.388e−3` |

---

## 15. Compliance checklist (enforce before "Issued")

| # | Check | Clause |
|---|---|---|
| V1 | Exactly one top event; wording unambiguous | 3, 7 |
| V2 | All system inputs recorded or justified N/A | 6.2 |
| V3 | All events labelled; repeated events share IDs; no duplicates; traceable | 8 |
| V4 | Event/state consistency in AND gates | 6.1.2 |
| V5 | No gate-to-gate links; each gate complete before development | 7.5.3 |
| V6 | Cut sets generated and reduced to minimal | 7.5.4.2 |
| V7 | Every basic event has `q` + source + applicability | 7.6, 9 |
| V8 | CCF groups identified; no naive multiplication of redundancies | 8, 5.2 |
| V9 | Approximation validity stated (rare-event conditions met, else EP/exact) | 7.5.5 |
| V10 | Dynamic branches solved by Markov/simulation and reinserted | 5.4.3, A.4 |
| V11 | FMEA cross-check findings closed | 5.4.1 |
| V12 | Report contains all Clause 9 minima | 9 |
| V13 | Reviewer sign-off recorded | 6.1 |
| V14 | Truncation (if used) disclosed with residual bound | 7.5.5 |
| V15 | Data provenance complete for every primary event | 9 |

---

## 16. Report template (Clause 9 minimum content)

1. **Objective and scope** — including what was excluded.
2. **System description** — functions, boundaries, interfaces, operational modes.
3. **Assumptions** — design, operation/maintenance, reliability model, approximation validity statement.
4. **Analysts and team** — expertise; top-event definition and acceptance criteria.
5. **Data** — references and applicability justification for **every** basic and undeveloped event.
6. **Analysis description** — symbols used, common-cause treatment, minimal cut sets.
7. **Results** — `Q_top` and the method used, cut-set ranking, importance/sensitivity conclusions.
8. **Conclusions and recommendations** — design actions against dominant cut sets.
9. **Annexes (optional)** — tree diagrams, data summary, FMECA cross-reference table.

---

## 17. Limits of IEC 61025 (state these in the report)

- No guidance on selecting failure-rate data sources — provenance is the analyst's responsibility.
- No formal importance-measure definitions (FV/Birnbaum are external conventions).
- No repairable-system dynamic analysis beyond steady-state, independent-repair forms; use IEC 61165 for Markov models.
- No software-failure quantification method; model software-derived failures as undeveloped events with a qualitative argument unless a defensible quantification basis exists.
- Cut sets from trees containing dynamic gates are approximations unless the dynamic branches are solved separately.
