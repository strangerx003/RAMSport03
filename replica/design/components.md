# RAMSport03 — console-v2 design system

Night-bench instrument console. Tokens live in `replica/design/tokens.json`;
check contrast after any change:

```
python "C:\Users\SIVA SAI\.config\opencode\skills\replica-design\contrast.py" replica/design/tokens.json
```

## Palette roles
| Role | Hex | Use |
|---|---|---|
| `bg` | `#101311` | page background (near-black green-charcoal) |
| `surface` / `surface-2` | `#191d19` / `#222822` | panels / raised panels |
| `border` / `border-strong` | `#2f362e` / `#454f43` | hairlines / input & table rules |
| `text` / `text-muted` / `text-faint` | `#e9ece6` / `#a2ab9d` / `#79817a` | body / secondary / apparatus labels |
| `accent` / `accent-hi` | `#f2a33c` / `#ffc168` | the ONE identity hue: amber phosphor readouts, CTAs, page seams |
| `on-accent` | `#20150a` | text on amber buttons/active tabs |
| `ok` / `warn` / `danger` | `#63d99b` / `#ffd166` / `#ff8570` | lamp semantics only |
| `danger-hard` | `#e04b38` | solid fault fill (critical matrix band), dark text on it |

Rules baked into the CSS:
- Amber is identity (KPI readouts glow, active nav channel, savebar, tabs). Red is reserved for faults.
- Badges are **status lamps**: pill + glowing dot of its own colour.
- KPIs are **bezel-framed gauges**: inset top-light/bottom-dark shadow, colour band strip on top edge, amber glowing value.
- Every label/header/button is mono uppercase (Cascadia/JetBrains fallback stack).
- A fixed CRT scanline + vignette overlay (`body::after`, `pointer-events:none`) sits above everything; disabled in print.
- Focus uses the amber outline; selection inverts to amber.

## Concrete components (map) 
- `.kpi` → bezel gauge; `.kpi-value` amber `--accent-hi` + text-shadow glow; band colour via inline `--band`.
- `.badge-{tone}` → lamp (see above). `.stamp`/`.stamp-accent` → topbar readout chips.
- `.nav-item.active` → lit channel: inset 3px amber bar left + amber text.
- `.topbar` → charcoal with amber underglow seam.
- `.savebar` → amber-edged commit strip with glow.
- `table.data .selected` / `.stale` / `.row-error` → inset colour bar + dim wash.
- `.matrix band-critical` → solid `#e04b38` with `#1d0d08` text (4.70:1 AA).

## Verified pairs (WCAG, via contrast.py)
All 16 token pairs pass AA (most AAA). Notable: text 15.67:1 on bg; accent-hi 10.62:1
on surface; ok 9.69, warn 11.83, danger 7.18 on surface; on-accent 8.59 on accent.
