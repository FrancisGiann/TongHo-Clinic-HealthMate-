# Conservative clinical risk-rule draft

HealthMate+ exposes a versioned, non-weighted candidate named **WHO IITT-informed partial screening (draft)** in Settings → Risk Rules. An administrator can create the inactive draft with one idempotent action, or load the candidate JSON into the draft form, review it, choose the next version, and save it. Creation leaves it in `draft`; only a school nurse account with a recorded PRC license can approve it for use. Approval retires the prior approved version.

## Candidate behavior

- A clinician-marked urgent warning sign returns `high` / `urgent` and requires a nurse acknowledgement.
- Temperature **strictly below 36 °C** or **strictly above 39 °C** returns `unclassified` / `requires-review` and requires the nurse to document review and action.
- The warning-sign screen must be explicitly answered after assessing the student. An unanswered or invalid screen returns `incomplete` and blocks saving; blank is not treated as “no warning sign.”
- Missing temperature returns `incomplete` / `requires-review`. A nurse may save with a written review/action acknowledgement only when temperature is the sole missing input. The assessment stays incomplete and is never converted to low/routine. An invalid temperature must be corrected.
- A valid temperature from 36 °C through 39 °C with the completed warning-sign screen showing no listed sign returns `review_required` / `unclassified`. This is not a clearance: the nurse must still complete and document the broader clinical assessment. No-match never means low risk or routine disposition.
- No pulse cutoff, pain-score cutoff, repeat-visit score, diagnosis, automatic disposition, or family alert is included.

The temperature signs are drawn from the WHO Interagency Integrated Triage Tool materials for adults and children. This draft uses those signs only to prompt review or up-triage. It does not claim to implement the complete IITT: the current visit form lacks its full danger-sign, age-specific, clinical observation, and disposition inputs. WHO does not provide a single pulse threshold that is suitable for all ages here, and the form does not define a supported numeric cutoff for severe pain. A licensed school nurse must assess those factors and the student's condition, including after a no-match result.

The candidate deliberately does not calculate a weighted score. The current form and available inputs are not a clinically validated prediction model. An urgent warning sign takes precedence even if temperature is missing; the assessment remains marked incomplete and still requires nurse documentation. The warning-sign screen itself cannot be skipped and overridden with an acknowledgement.

## Sources

- [WHO Interagency Integrated Triage Tool (IITT)](https://www.who.int/tools/triage)
- [WHO IITT, age 12 and older](https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_adult.pdf)
- [WHO IITT, under age 12](https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_pediatric.pdf)

## Legacy behavior

The version-0 demonstration profile remains available as the fallback when no approved version exists. Its historical weighted indicators and routine no-match result are unchanged. It is still explicitly labeled a demonstration and must not be represented as clinically validated.
