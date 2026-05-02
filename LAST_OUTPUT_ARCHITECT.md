>RESEARCH

To gather context for designing the generalized Arbitrage Engine with Daily Pacing, I invoke evaix-fetch for the following queries:

- evaix-fetch: "Prisma schema best practices for adding fields like BaseUrl, AuthEnvKey, RiskProfile, PromoBalance, BillingCycleEnd to a Provider model, and CooldownUntil, InputCostPerM, OutputCostPerM to a Models model in a Node.js/TypeScript environment."
  
- evaix-fetch: "xAI Grok model fleet details including grok-3, grok-4-fast, and associated pricing structures for input/output tokens per million, promo balances, and billing cycles."

- evaix-fetch: "High-level architecture patterns for arbitrage engines in multi-provider AI routing systems, focusing on daily spend pacing, phase-based governors (e.g., sprint to threshold then paced spending), exhaustion flagging, and proxy routing to zero-spend fallbacks."

- evaix-fetch: "Seed script patterns in Prisma for populating databases with provider fleets, models, and cost data, ensuring compatibility with TypeScript and environment variables."

- evaix-fetch: "Bypass mechanisms in session initiation for macro agents in AI orchestration systems, maintaining compatibility with existing initiateJulesSession without introducing pacing conflicts."

>PLAN

## High-Level Architecture for Generalized Arbitrage Engine with Daily Pacing

### 1. Prisma Schema Updates
- Extend the Provider model to include configurable attributes for integration and financial tracking: BaseUrl for API endpoints, AuthEnvKey for secure authentication, RiskProfile for tolerance levels in routing decisions, PromoBalance for tracking promotional credits, and BillingCycleEnd for cycle management.
- Enhance the Models model to support operational and cost metrics: CooldownUntil for temporary unavailability periods, InputCostPerM for input token pricing, and OutputCostPerM for output token pricing.
- Ensure schema migrations maintain backward compatibility, with default values for new fields to avoid disrupting existing data flows.

### 2. src/arbitrage.ts with 2-Phase Governor
- Architect the core arbitrage logic as a modular engine that evaluates provider eligibility based on real-time balances and pacing rules.
- Implement Phase 1 (Sprint Mode): Prioritize providers with untapped promo potential, aggressively routing requests until a $5 spend threshold per provider is met, unlocking further promo utilization without exceeding risk profiles.
- Transition to Phase 2 (Paced Mode): Compute a dynamic DailySpendTarget by dividing the remaining PromoBalance by the number of days until BillingCycleEnd, enforcing this cap per provider to optimize credit exhaustion.
- Introduce exhaustion handling: Upon reaching the DailySpendTarget, mark the provider as EXHAUSTED, apply a cooldown until the next midnight (UTC-aligned), and redirect all subsequent requests to a ZERO_SPEND_PROXY for fallback routing to non-promo providers.
- Integrate decision logic with existing routing hooks, ensuring the governor evaluates phases sequentially and logs transitions for auditability.

### 3. Seed Script for xAI Fleet (src/seed-models.ts)
- Design a one-time initialization script that populates the database with the full xAI provider fleet, including models like grok-3, grok-4-fast, and variants.
- Structure data ingestion to include model-specific details: names, capabilities, default pricing (e.g., input/output costs per million tokens), and provider linkages with initial PromoBalance and BillingCycleEnd values derived from xAI documentation.
- Make the script idempotent, using Prisma's upsert operations to avoid duplicates, and configurable via environment variables for sensitive data like BaseUrl and AuthEnvKey.
- Include validation steps to verify seeded data integrity post-execution, such as cross-checking costs against official rates.

### 4. MACRO_AGENT Bypass Maintenance
- Preserve the existing bypass logic in initiateJulesSession to exempt macro-level agents from arbitrage pacing, allowing direct provider access without governor interference.
- Ensure this exemption is scoped narrowly to session initiation, preventing leakage into paced routing flows, and document it as a configurable flag for future overrides.

This architecture ensures scalable, promo-optimized routing across providers while enforcing daily pacing to maximize value before billing cycles reset. All components remain high-level, deferring implementation to subsequent entangled phases.

>ROUTED_TO: ENTANGLER
