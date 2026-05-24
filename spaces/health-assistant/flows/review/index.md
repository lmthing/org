---
title: Health Review
description: Comprehensive personalized health review combining profile history with targeted research insights
defaultAgent: advisor
maxCycles: 10
sink:
  name: submitReview
  signature: (review: { generatedAt: string; profile: object; insights: object[]; timeline: object[]; recommendations: string[]; disclaimer: string }) => void
  description: Submit the completed health review
tasks:
  load_profile:
    description: Load the user's complete health history from the profile.
    outputSchema:
      type: object
      required: [history, profileExists]
      properties:
        history: { type: object }
        profileExists: { type: boolean }
  build_timeline:
    description: Construct a chronological timeline from all profile events.
    dependsOn: [load_profile]
    outputSchema:
      type: object
      required: [events]
      properties:
        events: { type: array }
  identify_topics:
    description: Analyze the profile for health topics warranting further research.
    dependsOn: [load_profile]
    outputSchema:
      type: object
      required: [topics]
      properties:
        topics: { type: array, items: { type: string } }
  research_topics:
    description: Delegate research for identified topics.
    dependsOn: [identify_topics]
    optional: true
    outputSchema:
      type: object
      properties:
        researchResults: { type: array }
  generate_insights:
    description: Synthesize profile data and research into personalized insights.
    dependsOn: [build_timeline, research_topics]
    outputSchema:
      type: object
      required: [insights]
      properties:
        insights: { type: array }
  compose_review:
    description: Assemble the complete health review report.
    dependsOn: [generate_insights]
    outputSchema:
      type: object
      required: [review]
      properties:
        review: { type: object }
  submit:
    description: Display the review and call submitReview.
    dependsOn: [compose_review]
---

Three-phase review flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Load Profile | `load_profile` → (`build_timeline` + `identify_topics`) |
| 2 — Research | `research_topics` |
| 3 — Compose & Submit | `generate_insights` → `compose_review` → `submit` |
