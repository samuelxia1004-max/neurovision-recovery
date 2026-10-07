# NeuroVision Recovery

A local-first research prototype for ICL/TICL postoperative visual practice.

The application combines adaptive contrast tasks with condition-aware progression. Its clinical benefit in ICL patients requires prospective validation.

## Use

[Open the live application](https://samuelxia1004-max.github.io/neurovision-recovery/), or open `app/index.html` in a modern browser. Keep the folder structure intact for offline report recognition.

1. Add ICL/TICL surgery dates and the postoperative clinician review in **手术档案**.
2. Review imported report fields before saving.
3. Start the schedule in **今日训练**. Pause or end whenever needed.
4. Export JSON before changing browsers, devices, or website addresses.

Browser storage belongs to the current origin. A local file and a hosted website have separate storage.

## Practice

The four tasks cover contrast orientation, spatial scales, collinear target detection, and orientation in external noise. Correct responses receive feedback. A three-down, one-up controller changes digital contrast.

Familiarization uses 500 ms presentations. Formal practice uses 200 ms and an independent staircase. Task, actual spatial frequency, flanker spacing, and presentation duration each define a separate condition.

Progression requires complete, comfortable sessions on separate days, valid responses, and adequate coverage of the fundamental scales. Background and noise tasks extend the practice context. Daily allocation is capped by a 240-second engineering budget. The budget does not establish a clinical dose.

Recent history can initialize difficulty after the user confirms matching viewing conditions. The controller checks profile, clinician review, display geometry, condition, recency, and record quality.

The interface shows actual practice days and condition coverage. Condition summaries report formal responses and the recent stimulus contrast.

## Research basis

[Research notes](docs/research.md) map each design choice to its evidence and validation requirement. Normalization plasticity and decision-readout learning represent different computational stages. Improved task performance can reflect either process, so the application retains stimulus and exposure history.

The current computational work supports explicit condition tracking and uncertainty-aware interpretation. Patient outcomes require a separate study.

## Data

Report recognition runs locally with bundled OCR resources. Uploaded images and report text are processed in memory. Only confirmed fields enter browser storage. The application provides JSON backup and import.

A public release contains application code, synthetic test fixtures, documentation, and third-party resource notices. See `app/vendor/ocr/` for upstream licenses and resource provenance.

## Verification

The regression suite contains 94 checks covering condition summaries, calendar boundaries, staircase isolation, plan allocation, and storage integrity.

Online browser checks on 7 October 2026 used synthetic surgery data. Starting, pausing, resuming, ending, saving, and retaining records after reload worked. Clicking outside the report editor closed it. At a 390-pixel viewport, the home and profile pages had no document overflow. An interrupted-session heading was corrected to exclude tasks that never began.

One online synthetic-image recognition attempt reached the OCR timeout. Clearing its temporary image worked. Image recognition still needs further browser validation. Text import and manual entry are available.

Tests distinguish software integrity, controller simulation, and clinical outcomes. Fixed-observer simulations evaluate controller behavior.
