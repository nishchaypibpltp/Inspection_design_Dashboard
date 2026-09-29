# Inspection Dashboard Improvement Metrics

**Product specification — Version 1.0**  
**Date:** 23 September 2026  
**Scope:** Customer inspection journey, stage exits, retakes, guidance effectiveness, and call-centre recovery  

## 1. Purpose

This document defines the metrics selected for the inspection dashboard. Each metric answers one of three product questions:

1. **Where did users leave?**
2. **Why did they leave?**
3. **Did the call-centre contact process bring them back and help them finish successfully?**

The document deliberately defines the desired product metrics independently of current data availability. It is intended to guide dashboard design, event instrumentation, backend queries, and later implementation.

## 2. Important naming corrections

Two handwritten formulas were correct calculations but had the wrong metric names:

- `Users completing stage n ÷ users completing stage n−1` is **stage-to-stage conversion**, not exit rate.
- `Users completing stage n ÷ users who started the inspection` is **cumulative stage reach**, not net exit rate.

The corresponding exit/drop-off metrics are `1 − conversion`.

## 3. Standard definitions

These definitions must be shared by the dashboard, backend and call-centre reporting.

- **Inspection started:** the user begins the first inspection stage.
- **Stage started:** stage n is displayed and is ready for interaction.
- **Stage completed:** the required capture for stage n passes the completion rule and the user can continue.
- **Stage exit:** stage n was started but not completed before the session was explicitly abandoned, expired, or inactive for the agreed threshold. Recommended initial inactivity threshold: 24 hours.
- **Eligible exit pool:** users who exited and are eligible for call-centre contact.
- **Contact attempted:** the call centre makes a recorded outbound attempt.
- **Contact connected:** the user answers and the agent speaks with them.
- **Resume:** the user reopens the inspection after the contact.
- **Stage recovered:** the user completes the stage where they previously exited.
- **Inspection recovered:** the user completes the full inspection.
- **Clean completion:** the completed inspection has no blocking QC finding.
- **Attribution window:** the period after contact in which a return is attributed to the contact. Recommended starting point: 72 hours, configurable.

## 4. Dashboard structure

The dashboard should have three connected sections:

1. **Stage funnel:** where users are lost.
2. **Exit diagnosis:** what likely caused the exit.
3. **Call-centre recovery:** whether contact brought the user back and resolved the blocker.

Every metric should support filters for date, stage, insurer, platform, OS version, app version, device type, network type, and contact-support status.

---

# Section A — Stage funnel and exit metrics

## A1. Stage-to-stage conversion rate

**Formula**

`Distinct users completing stage n ÷ distinct users completing stage n−1 × 100`

**Why**

Shows how effectively users move from one stage to the next. It identifies the exact transition where the journey begins losing users.

**How it increases visibility**

If 100 users complete the previous stage but only 80 complete the next stage, the conversion is 80%. The dashboard can immediately direct attention to that transition instead of treating the entire inspection as one completion number.

**Recommended display**

A funnel with the user count and conversion percentage between every two stages.

## A2. Stage exit rate

**Formula**

`Distinct users who started stage n but did not complete it ÷ distinct users who started stage n × 100`

Equivalent:

`100% − stage completion rate`

**Why**

This is the clearest measurement of the percentage of users lost inside each stage.

**How it increases visibility**

Ranking stages by exit rate creates an immediate priority list. A heat map should highlight the highest-exit stages. A sudden increase after a product release also points to the stage affected by that release.

**Recommended display**

A stage heat map: green for low exit, amber for moderate exit, and red for high exit. Always show the numerator and denominator beside the percentage.

## A3. Cumulative stage reach rate

**Formula**

`Distinct users completing stage n ÷ distinct users who started the inspection × 100`

**Why**

Stage exit rate measures local friction. Cumulative reach measures the total damage caused by all previous exits.

**How it increases visibility**

A 10% exit near the start loses more users than the same rate near the end. This metric helps prioritise work by the number of inspections affected, not only by the local percentage.

**Recommended display**

A complete inspection funnel from inspection start to clean completion.

## A4. Cumulative exit rate at stage n

**Formula**

`100% − cumulative stage reach rate`

or

`Users who started the inspection but did not complete stage n ÷ users who started the inspection × 100`

**Why**

Provides the total percentage of the original cohort lost by each point in the journey.

**How it increases visibility**

It shows whether most losses happen before the user reaches a difficult document stage or within that stage itself.

**Recommended display**

Show beside A3 in the funnel; do not create a separate chart.

---

# Section B — Understanding why users leave

## B1. Time spent in stage: exiters versus completers

**Formula**

- `Median(stage exit time − stage start time)` for users who exited.
- `Median(stage completion time − stage start time)` for users who completed.
- Also show the 90th percentile for both groups.

**Why**

The time before exit indicates what kind of difficulty the user faced.

**How it increases visibility**

- Exiting within seconds suggests confusion, no intent, a stage that did not load, or an immediate permission problem.
- Spending much longer than successful users suggests the user tried but became stuck.
- Long time combined with repeated retakes suggests guidance or AI rejection problems.

Use the **median** as the main number because a few abandoned sessions can remain open for hours and distort the mean.

**Recommended display**

Two bars per stage: median time for completers and median time for exiters.

## B2. Retakes before exit

**Formula**

`Total retake attempts made at stage n before exit ÷ distinct users who exited at stage n`

Also show:

`Users with at least one retake before exit ÷ users who exited at stage n × 100`

**Why**

Separates users who left immediately from users who repeatedly tried to satisfy the AI.

**How it increases visibility**

- High retake incidence and high median attempts indicate a stage-wide guidance or AI problem.
- Low incidence with a high mean indicates a few individual users or devices are driving the result.
- Repeating the same rejection reason after multiple attempts suggests the guidance is not helping.

**Recommended display**

For each stage show retake incidence, median attempts among affected users, and the top rejection reason.

## B3. Exit reason mix

**Formula**

`Exits assigned to reason r at stage n ÷ all exits at stage n × 100`

**Reason groups**

- Lack of intent / user chose not to continue
- No time or vehicle unavailable
- Confusion with instructions
- Permission denied
- Stage or camera did not load
- App or device error
- Poor network / upload failure
- Repeated AI or QC rejection
- Other / unknown

**Why**

Exit rate answers where the user left. Exit reason answers why.

**How it increases visibility**

The owner of the fix becomes clear:

- Technical failures go to engineering.
- Confusing instructions go to product and design.
- Repeated QC rejection goes to the AI/QC team.
- Lack of intent or timing issues inform the contact strategy.

**Recommended display**

A stacked bar per stage, split by reason group.

## B4. Last QC or guidance message before exit

**Formula**

`Users whose last message before exit was message m ÷ users who exited after seeing any message × 100`

Also show:

`Exit rate after message m = users who exited after seeing m ÷ users who saw m × 100`

**Why**

The last instruction shown is often the most direct clue about what the user could not resolve.

**How it increases visibility**

If users repeatedly leave after “text not readable,” the message may not explain how to correct glare, distance, angle, or focus. Comparing messages reveals which wording works and which one needs redesign.

**Recommended display**

A table with message, stage, users shown, exit rate, repeated-retake rate, and next-attempt pass rate.

## B5. Technical-exit rate

**Formula**

`Users exiting after a stage-load, camera, app, network or upload error ÷ users starting that stage × 100`

**Why**

Prevents technical failures from being mislabelled as user abandonment.

**How it increases visibility**

Splitting this metric by platform and OS version reveals whether a stage is difficult for everyone or broken only on a specific device, operating system, app version, or network type.

**Recommended display**

A stage-by-platform error heat map with the top error code.

---

# Section C — Call-centre contact and recovery metrics

## C1. Contact coverage

**Formula**

`Distinct eligible exited users with at least one contact attempt ÷ distinct eligible exited users × 100`

**Why**

A high success rate has limited business impact if only a small share of exited users is contacted.

**How it increases visibility**

Shows whether call-centre capacity matches exit volume and whether some stages, days, or customer segments are being missed.

**Recommended display**

Headline percentage with contacted and uncontacted user counts.

## C2. Median time from exit to first contact attempt

**Formula**

`Median(first contact-attempt timestamp − exit timestamp)`

**Why**

The user’s intent and availability decline over time.

**How it increases visibility**

Comparing recovery rate by contact delay reveals the best contact window and helps establish the call-centre service-level target.

**Recommended display**

Median time plus recovery rates for delay bands such as under 15 minutes, 15–60 minutes, 1–6 hours, and over 6 hours.

## C3. Call connect rate

**Formula**

`Answered calls ÷ attempted calls × 100`

Also show:

`Average attempts required per connected user`

**Why**

Separates difficulty reaching the user from difficulty convincing the user to resume.

**How it increases visibility**

- Low connect rate suggests problems with timing, caller ID, or channel.
- High connect rate with low recovery suggests the script, agent coaching, or product problem is not being resolved.

**Recommended display**

A compact funnel: attempted calls → connected users → resumed users.

## C4. Post-contact resume rate

**Formula**

`Connected users who reopen the inspection within the attribution window ÷ connected users × 100`

**Why**

Measures the first behavioural response to a successful call.

**How it increases visibility**

Shows whether the agent persuaded the user to act. It should not be treated as final success because reopening does not mean the stage was solved.

**Recommended display**

First step in the contact-success funnel.

## C5. Post-contact stage recovery rate

**Formula**

`Connected users who complete the stage where they exited within the attribution window ÷ connected users × 100`

**Why**

Measures whether the call actually resolved the blocker that caused the exit.

**How it increases visibility**

The gap between resume rate and stage recovery rate shows how many users returned but remained stuck. Break this down by stage and agent disposition.

**Recommended display**

Primary stage-level call-centre metric.

## C6. Post-contact inspection completion rate

**Formula**

`Connected users who complete the full inspection within the attribution window ÷ connected users × 100`

**Why**

Shows whether the recovered user ultimately completed the customer journey.

**How it increases visibility**

The gap between stage recovery and full completion identifies users who solved the original blocker but exited later in the journey.

**Recommended display**

Third step in the contact-success funnel.

## C7. Post-contact clean completion rate

**Formula**

`Connected users who complete with no blocking QC finding ÷ connected users × 100`

**Why**

This is the strongest definition of call-centre success. A user who finishes with unusable evidence has not created a usable business outcome.

**How it increases visibility**

Shows whether agents are merely pushing users through or helping them submit acceptable captures.

**Recommended display**

Final and primary business outcome in the contact-success funnel.

## C8. Median time from connected call to session resume

**Formula**

`Median(first session-resume timestamp after contact − connected-call timestamp)`

**Why**

Shows whether users act immediately during or after the call, or promise to continue but delay.

**How it increases visibility**

A long delay suggests using a deep link, sending a reminder, or keeping the user on the call until the inspection is reopened.

**Recommended display**

Median and 90th percentile, split by contact channel and stage.

## C9. Post-contact session duration

**Formula**

For recovered sessions:

`Median(completion or second-exit timestamp − post-contact resume timestamp)`

Also show the mean as a secondary diagnostic.

**Why**

Measures the effort still required after the user returns.

**How it increases visibility**

- Shorter duration than organic returners suggests the agent removed the confusion.
- Longer duration suggests the user remains stuck.
- Split by stage and with/without live agent support to identify where assistance helps.

**Recommended display**

Median post-contact duration compared with organic-return duration.

## C10. Re-exit rate after contact

**Formula**

`Contacted users who resume and exit again ÷ contacted users who resume × 100`

Also show:

`Same-stage re-exit rate = users who exit again at the original stage ÷ users who resume × 100`

**Why**

A resumed user who exits again was not fully recovered.

**How it increases visibility**

Same-stage re-exit means the original problem was not solved. A later-stage exit means the call fixed the first blocker but another problem appeared.

**Recommended display**

Re-exit rate by original exit stage, with same-stage and later-stage portions.

## C11. Assisted versus unassisted stage conversion

**Formula**

`Stage completion rate among users receiving call support − stage completion rate among comparable users without call support`

Report both raw rates and the percentage-point difference.

**Why**

Shows the true additional benefit of call support.

**How it increases visibility**

Some users would have returned without a call. Comparing contacted and uncontacted users prevents the dashboard from crediting the call centre for organic recoveries.

For a reliable measurement, randomly keep a small eligible holdout group uncontacted or use a carefully matched comparison group.

**Recommended display**

Side-by-side conversion bars by stage: with call support, without call support, and uplift.

## C12. Agent-level recovery rate

**Formula**

`Connected users achieving clean completion ÷ connected users handled by agent × 100`

Supporting metrics:

- Stage recovery rate by agent
- Re-exit rate by agent
- Median handle time
- Customer mix and exit-stage mix

**Why**

Identifies scripts, coaching methods, and agent behaviours associated with successful recovery.

**How it increases visibility**

Raw agent rankings can be unfair if one agent receives harder stages or customer segments. Show agent performance only after controlling for stage and case difficulty.

**Recommended display**

Agent scorecard with minimum sample-size rules; do not publish rankings for very small samples.

---

# Section D — Shared breakdowns

These are dimensions applied to the metrics above, not separate metrics:

- iOS versus Android
- OS version
- App or web version
- Device model
- Network type and connection quality
- Inspection stage and document type
- Insurer and campaign
- Contacted versus not contacted
- Connected versus not connected
- Live call support versus call completed before resume
- New versus returning user
- Date and time of exit

These breakdowns reveal whether a problem is universal or concentrated in one technical or behavioural segment.

---

# Section E — Recommended dashboard order

## Row 1: Journey health

1. Inspections started
2. Clean completion rate
3. Highest stage exit rate
4. Technical-exit rate

## Row 2: Stage funnel

- Stage-to-stage conversion
- Stage exit rate
- Cumulative reach
- User counts at every stage

## Row 3: Exit diagnosis

- Exit reason mix
- Exiters versus completers stage time
- Retakes before exit
- Last QC message before exit

## Row 4: Call-centre funnel

`Eligible exits → contact attempted → connected → resumed → stage recovered → inspection completed → clean completion`

Show count and conversion between every step.

## Row 5: Contact-process diagnostics

- Contact coverage
- Time to first attempt
- Connect rate
- Time from call to resume
- Post-contact session duration
- Re-exit rate
- Assisted versus unassisted uplift

---

# Section F — Minimum event and data contract

## Journey events

- `inspection_started`
- `stage_started`
- `stage_completed`
- `stage_exited`
- `capture_attempted`
- `capture_rejected`
- `guidance_shown`
- `help_opened`
- `permission_prompted`
- `permission_granted`
- `permission_denied`
- `technical_error`
- `session_resumed`
- `inspection_completed`

## Contact events

- `contact_eligible`
- `contact_attempted`
- `contact_connected`
- `contact_failed`
- `contact_disposition_recorded`
- `holdout_assigned`

## Required shared fields

- `event_id`
- `session_id`
- `customer_id`
- `event_type`
- `event_timestamp`
- `stage_id`
- `stage_type`
- `attempt_number`
- `platform`
- `os_version`
- `app_version`
- `device_model`
- `network_type`
- `error_code`
- `qc_reason`
- `guidance_message_id`
- `contact_id`
- `agent_id`
- `contact_channel`
- `contact_disposition`

## Contact disposition list

Use a fixed list rather than free text:

- Did not understand the step
- Repeated AI/QC rejection
- Technical or app issue
- Network issue
- Permission or privacy concern
- No time
- Vehicle or document unavailable
- Not interested
- Wrong contact
- Other

Allow optional agent notes in addition to the fixed category.

---

# Section G — Measurement rules

1. Count **distinct users or sessions**, not raw events, in conversion rates.
2. Always show the numerator and denominator next to a percentage.
3. Use the **median** as the main time metric and the 90th percentile as the long-tail measure.
4. Define one attribution window for contact metrics and display it in the dashboard.
5. Do not call a resume a success. The primary outcome is clean inspection completion.
6. Separate user exits from technical exits.
7. Compare contacted users with an uncontacted holdout to measure true uplift.
8. Apply minimum sample-size rules before comparing platforms, stages, or agents.
9. Preserve the actual journey path because conditional stages may differ by inspection.
10. Exclude internal test traffic from production product metrics.

---

# Section H — Implementation priority

## Phase 1: Core stage visibility

- A1 Stage-to-stage conversion
- A2 Stage exit rate
- A3 Cumulative reach
- B1 Exiters versus completers time
- B2 Retakes before exit
- B3 Exit reason mix
- B4 Last QC message before exit

## Phase 2: Contact-process launch

- C1 Contact coverage
- C2 Time to first contact
- C3 Connect rate
- C4 Resume rate
- C5 Stage recovery rate
- C6 Inspection completion rate
- C7 Clean completion rate

## Phase 3: Optimisation and attribution

- C8 Time from call to resume
- C9 Post-contact session duration
- C10 Re-exit rate
- C11 Assisted versus unassisted uplift
- C12 Agent-level recovery

## Final product principle

The dashboard should never stop at **“where did users leave?”** It should connect:

`where they left → likely reason → intervention provided → whether they returned → whether the original stage was solved → whether they completed cleanly`

That chain turns the dashboard from a reporting screen into a product-improvement and call-centre decision system.
