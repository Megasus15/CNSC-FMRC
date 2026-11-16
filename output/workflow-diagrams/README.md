# UCN-FMRC Workflow Pack

45 independent workflows plus a navigation overview (F00). No production records or credentials are included.

- Open `UCN-FMRC-Editable-Workflow-Library.drawio` in draw.io / diagrams.net for the linked 46-page editable library.
- Open `drawio/Fxx.drawio` for one editable flow. Shapes, labels, lanes and connectors are native vectors.
- `svg/`: self-contained SVGs with embedded Montserrat, accessible descriptions and sibling links.
- `png/`: A3 landscape exports at 300 dpi (4961 x 3509 pixels).
- `pdf/`: 46 individual vector PDFs and a combined 51-page bookmarked, searchable booklet.
- `STEP_BY_STEP.md`: text equivalent, alternative paths and rules.
- `SOURCE_REGISTER.md`: current code anchors. `source/`: canonical JSON, generator and licensed font files.
- `TECHNICAL_REFERENCE.md`: role boundaries, state safeguards and compatibility notes.
- `VERIFY_REPORT.json` and `SHA256SUMS.json`: local structural checks and file integrity.

Install the included Montserrat fonts to see the same type in the draw.io editor. PDFs and SVGs already embed them.
The combined PDF uses internal links; standalone PDFs use sibling PDF filenames, so keep those files together.

## Rebuild

Copy `source/` to `docs/workflows/` in the documented repository baseline. Run `python docs/workflows/generate.py`
using Python with ReportLab, Pillow and pypdf installed, plus Poppler's `pdftoppm` on PATH. The Codex bundled
runtime already includes these tools. This generator invokes no application API and makes no workflow mutations.

## Interpretation

The main route is a common successful route; use labelled alternatives and key rules for exceptions. "If needed"
actions are optional. Provider-dependent functionality is subject to real server configuration. These documents
are not proof of a live payment, email, refund or courier event. Future code changes require diagram review.

## Design references

- [draw.io swimlane guidance](https://www.drawio.com/docs/diagram-types/swimlane-diagrams/)
- [draw.io process mapping](https://www.drawio.com/docs/best-practice/process-map-flowchart/)
- [draw.io vector SVG export](https://www.drawio.com/docs/manual/export/export-to-svg/)
- [W3C complex-image text alternatives](https://www.w3.org/WAI/tutorials/images/complex/)

