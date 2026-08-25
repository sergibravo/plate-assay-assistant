# Reference workbooks

The spreadsheets this app replaces. They are the **source of truth for every formula**: when
a calculation is questioned, it is checked against these files.

| File | Sheets used | Implemented in |
| --- | --- | --- |
| `260821_hibit_transfection_optimisation_dilutions_template.xlsx` | `Setup`, `PEI Mix`, `DNA Mixes` | module 1 |
| | `Plate Layout` | module 2 (not built) |
| | `Dilutions` (simpler precursor) | module 3 (not built) |
| `layout-aquous.xlsx` | `Compounds` (improved version, with DMSO matching) | module 3 (not built) |

These are **snapshots**, copied 2026-08-25 from `~/Desktop` and `~/Documents`; the originals
were left in place. If you change a workbook and want the app checked against the new
version, copy it in here again and say so — the formulas transcribed in
[`../docs/formulas.md`](../docs/formulas.md) would need re-checking.

Nothing here is read at runtime: the app never opens these files, and they are not part of
the built `dist/` bundle.
