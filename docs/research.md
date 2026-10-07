# Research basis for visual practice

NeuroVision Recovery presents structured visual practice for ICL/TICL postoperative users with a recorded clinician review. Its training effects in this population await a prospective comparison.

## Representation and readout

Divisive normalization scales a channel response by activity in a surrounding population. Westrick and colleagues modeled adaptation through changes in normalization interactions driven by response products. This supplies a computational account of sensory adaptation.

Decision-readout learning changes the weights linking sensory responses to task decisions. Dosher and colleagues used external-noise manipulations and reweighting models to study this process. These changes act downstream of the sensory representation.

The two accounts can yield similar trained accuracy. The accompanying image-computable research found that noise, transfer, and recovery conditions supplied additional behavioral information. Attribution remained dependent on candidate support, observation assumptions, and exposure history.

The application records those conditions rather than assigning an inferred neural mechanism to each user.

## Four tasks

| Task | Practice goal | Design source |
|---|---|---|
| Contrast orientation | Extract weak orientation information with feedback | Adaptive Gabor practice and perceptual-learning studies |
| Spatial scales | Practice coarse, medium, and fine structures separately | Multiscale visual representation and cross-frequency transfer |
| Collinear target | Detect a central pattern among aligned flankers | Contextual visual interactions and lateral-masking practice |
| External noise | Extract relevant orientation information amid visual noise | External-noise filtering and channel reweighting |

The last two tasks extend the fundamental practice conditions. Their use in this software is a research hypothesis.

## Clinical translation

Piñero and colleagues enrolled 60 people with trifocal intraocular lenses in a placebo-controlled trial. Participants received 20 sessions of 30 minutes. Some contrast-sensitivity outcomes favored active training. The study involved calibrated tablets and a different surgical population.

ICL preserves the crystalline lens. Its optical and patient context differs from trifocal lens replacement. The published schedule therefore cannot establish the effective dose for this application.

The software uses short exposure budgets for feasibility work. Surgery dates and clinician review establish the use context. Intraocular pressure, vault, and lens dimensions remain recorded clinical variables. Current evidence supplies no validated equation mapping those values to training minutes.

## What the software retains

A formal stimulus lasts 200 ms. Familiarization has a separate 500 ms staircase. Actual frequency, flanker spacing, noise seeds, exposure times, interruptions, and difficulty updates are retained.

History-based initialization uses the same recorded condition and geometry, a recent reviewed plan, and sufficient valid responses. Display-limited frequencies remain explicit. Legacy records retain their original protocol.

Coverage counts describe completed practice. Digital contrast is an input to the task, and its recent median is a controller summary. Independent outcomes are needed to establish transfer and clinical benefit.

## Validation path

A feasibility study should first evaluate usability, display consistency, adherence, and tolerability. A controlled patient study should then compare training with a credible control while measuring natural postoperative recovery.

Prespecified outcomes should include independent contrast sensitivity, relevant daily visual function, symptoms, and retention after training stops. Untrained conditions help test transfer. Optical status and clinician follow-up should be recorded alongside those outcomes.

## Sources

- Westrick ZM, Heeger DJ, Landy MS. Pattern adaptation and normalization reweighting. *Journal of Neuroscience* 36:9805–9816 (2016). [doi:10.1523/JNEUROSCI.1067-16.2016](https://doi.org/10.1523/JNEUROSCI.1067-16.2016).
- Dosher BA, Lu ZL. Perceptual learning reflects external noise filtering and internal noise reduction through channel reweighting. *PNAS* 95:13988–13993 (1998). [doi:10.1073/pnas.95.23.13988](https://doi.org/10.1073/pnas.95.23.13988).
- Dosher BA, Jeter P, Liu J, Lu ZL. An integrated reweighting theory of perceptual learning. *PNAS* 110:13678–13683 (2013). [doi:10.1073/pnas.1312552110](https://doi.org/10.1073/pnas.1312552110).
- Piñero DP et al. Randomised placebo-controlled clinical trial evaluating the impact of a new visual rehabilitation program on neuroadaptation in patients implanted with trifocal intraocular lenses. *International Ophthalmology* 43:4035–4053 (2023). [doi:10.1007/s10792-023-02809-9](https://doi.org/10.1007/s10792-023-02809-9).
