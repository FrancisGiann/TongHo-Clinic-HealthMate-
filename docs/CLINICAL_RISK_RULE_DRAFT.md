# Conservative clinical risk-rule draft

HealthMate+ automatically uses the built-in **Sample risk rules** when no clinician-approved custom rules exist. The sample keeps the existing weighted indicators and is explicitly unapproved; it does not claim clinical validation. Settings explains the sample without requiring setup. Custom rules and the optional non-weighted **WHO IITT-informed partial screening** candidate remain available under Advanced settings. Saved rules stay out of use until a school nurse with a PRC license verified and recorded by an administrator approves them. Approval retires the previously approved version.

## Candidate behavior

- A clinician-marked urgent warning sign returns `high` / `urgent` and requires a nurse acknowledgement.
- Temperature **strictly below 36 °C** or **strictly above 39 °C** returns `unclassified` / `requires-review` and requires the nurse to document review and action.
- The warning-sign screen must be explicitly answered after assessing the student. An unanswered or invalid screen returns `incomplete` and blocks saving; blank is not treated as “no warning sign.”
- Missing temperature returns `incomplete` / `requires-review`. A nurse may save with a written review/action acknowledgement only when temperature is the sole missing input. The assessment stays incomplete and is never converted to low/routine. An invalid temperature must be corrected.
- A valid temperature from 36 °C through 39 °C with the completed warning-sign screen showing no listed sign returns `review_required` / `unclassified`. This is not a clearance: the nurse must still complete and document the broader clinical assessment. No-match never means low risk or routine disposition.
- No pulse cutoff, pain-score cutoff, repeat-visit score, diagnosis, automatic disposition, or family alert is included.

The temperature signs are drawn from the WHO Interagency Integrated Triage Tool materials for adults and children. This draft uses those signs only to prompt review or up-triage. It does not claim to implement the complete IITT: the current visit form lacks its full danger-sign, age-specific, clinical observation, and disposition inputs. WHO does not provide a single pulse threshold that is suitable for all ages here, and the form does not define a supported numeric cutoff for severe pain. A licensed school nurse must assess those factors and the student's condition, including after a no-match result.

The candidate deliberately does not calculate a weighted score. The current form and available inputs are not a clinically validated prediction model. An urgent warning sign takes precedence even if temperature is missing; the assessment remains marked incomplete and still requires nurse documentation. The warning-sign screen itself cannot be skipped and overridden with an acknowledgement.

## Rule selection and custom approval

New assessments always use the newest clinician-approved custom rule, when one exists. Otherwise they use the built-in sample in every environment. Old `testRiskRuleActivation` values in clinic settings are ignored and are left untouched with the rest of the settings record. Previously saved assessments with `test_active` status remain unchanged; if displayed, the frontend labels them as development tests, not approvals.

Creating or saving custom rules does not change assessments. Only a school nurse whose PRC license was verified and recorded by an administrator can approve a rule for use; administrators may prepare drafts but cannot approve them. Approval records the nurse and date, and retires the prior approved version.

To make a nurse eligible for clinical rule approval, an administrator opens Settings → Users, enters the PRC license number after checking it against an authoritative source, and confirms that independent verification. Nurses cannot record their own license. The user list shows whether an administrator recorded a verified license without displaying the number; clearing the record removes both the number and verification state. A pre-existing unverified number alone does not enable approval.

## Sources

- [WHO Interagency Integrated Triage Tool (IITT)](https://www.who.int/tools/triage)
- [WHO IITT, age 12 and older](https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_adult.pdf)
- [WHO IITT, under age 12](https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_pediatric.pdf)

## Built-in sample behavior

The version-0 sample remains the automatic fallback when no approved custom rule exists. Its existing weighted indicators, thresholds, and no-match behavior are unchanged. It is labeled as sample and unapproved in Settings and on new assessment results; it must not be represented as clinically validated.
