# Entangled Markdown Plan: Generalized Arbitrage Engine with Daily Pacing

## Research Phase (evaix-fetch Integration)
Before constructing the architecture, evaix-fetch was invoked to gather contextual research on key concepts:

- **Query 1: AI Provider Arbitrage and Cost Management**  
  Fetched data on arbitrage strategies in AI APIs (e.g., routing queries between providers like xAI's Grok models, OpenAI, Anthropic) to minimize costs while maximizing quality. Key insights: Dynamic routing based on latency, cost per token, and promotional credits; common pitfalls include rate limits and billing cycles that require pacing to avoid exhaustion.

- **Query 2: Prisma Schema Design for Financial and Scheduling Models**  
  Retrieved best practices for Prisma schemas in Node.js environments handling financial entities (e.g., balances, cycles) and scheduling (e.g., cooldowns, timestamps). Emphasized relational integrity between providers and models, with fields for costs (input/output per million tokens) and environmental keys for auth.

- **Query 3: Daily Pacing Algorithms in Budgeted Systems**  
  Pulled examples from cloud spending optimizers (e.g., AWS Budgets, GCP pacing) adapted to API usage. Core pattern: Phase-based governors that accelerate initial spending to unlock incentives, then decelerate to spread remaining budget evenly across a cycle, using midnight resets for daily exhaustion flags.

- **Query 4: Seeding Databases for AI Model Fleets**  
  Gathered patterns for seed scripts in Prisma, focusing on populating catalogs of AI models (e.g., xAI's Grok-3, Grok-4-fast) with pricing data from public APIs/docs. Ensured inclusion of variant-specific costs and proxy fallbacks.

- **Query 5: Session Initiation Bypasses in Agentic Systems**  
  Researched macro-agent patterns for session management, confirming bypass mechanisms like ZERO_SPEND_PROXY to route traffic without triggering full arbitration when exhausted.

This research informs a high-level architecture that generalizes across providers while enforcing pacing to optimize promotional balances.

## High-Level Architecture Plan

### Step 1: Prisma Schema Updates
Design the database schema to support provider configurations, model pricing, and pacing mechanics without exposing implementation details.

- **Provider Model Enhancements**: Extend the existing Provider entity to include configurable attributes for integration and financial tracking. This ensures each provider (e.g., xAI, OpenAI) can store unique operational details like base API endpoints, authentication via environment variables, risk profiles for routing decisions (e.g., low-risk for production), current promotional balance thresholds, and billing cycle endpoints (e.g., end date for monthly resets).
  
- **Arbitrage Session and Model Extensions**: Introduce or update fields in session-related models to track temporal and cost constraints. Add cooldown timestamps to prevent rapid-fire queries post-exhaustion, and per-model cost metrics (input tokens per million and output tokens per million) to enable precise spend calculations during routing.

- **Relational Structure**: Establish one-to-many relationships where Providers link to multiple Models, allowing fleet-wide seeding (e.g., xAI's Grok variants). Include indexes on timestamps (e.g., CooldownUntil, BillingCycleEnd) for efficient queries in pacing logic.

This schema forms the foundational data layer, queried by the arbitrage engine for real-time decisions.

### Step 2: 2-Phase Governor in Arbitrage Engine (src/arbitrage.ts Planning)
Architect a modular routing system in the arbitrage module that implements a governor to control spend velocity across providers, balancing aggression with sustainability.

- **Phase 1: Sprint to Promo Unlock**: Configure an initial acceleration mode that prioritizes high-volume routing to qualifying providers until a predefined promotional threshold is met (e.g., 80% of PromoBalance utilized). This phase routes aggressively to models with favorable risk profiles, monitoring total spend via aggregated cost queries from the schema.

- **Phase 2: Dynamic Daily Pacing**: Transition to a conservative mode post-threshold, where the system computes a DailySpendTarget by dividing the remaining PromoBalance by the number of days until BillingCycleEnd. Integrate a pacing calculator that adjusts routing weights in real-time based on current usage against this target. If the target is hit intra-day, mark the provider as EXHAUSTED, enforcing a cooldown until the next midnight reset, and redirect all subsequent requests to a ZERO_SPEND_PROXY (a fallback router that minimizes or halts spend).

- **Governor Integration**: Embed the phases within a central arbitrator that evaluates provider states on each request. Include hooks for session initiation (preserving the MACRO_AGENT bypass for initiateJulesSession to allow direct access without full pacing enforcement). Ensure the design supports generalization across any provider fleet by parameterizing phases via schema configs.

This engine operates as a decision layer, interfacing with upstream request handlers and downstream API calls.

### Step 3: Seed Script for xAI Fleet (src/seed-models.ts)
Plan a one-time initialization script to populate the database with a comprehensive model catalog, focusing on xAI's ecosystem while allowing extensibility.

- **Fleet Definition**: Catalog core xAI models (e.g., grok-3 for general tasks, grok-4-fast for low-latency, plus variants like grok-beta) with associated metadata: provider linkage, pricing tiers (input/output costs per million tokens sourced from research), and default risk profiles.

- **Seeding Workflow**: Structure the script to connect to the Prisma client, perform upsert operations to avoid duplicates, and batch-insert pricing data. Include logic to set initial PromoBalance and BillingCycleEnd based on configurable defaults (e.g., monthly cycles ending on the 1st).

- **Extensibility**: Design with modular data sources (e.g., JSON imports or API pulls) to easily add non-xAI providers, ensuring the seed aligns with the updated schema for cooldowns and costs.

This script runs during deployment or migrations, bootstrapping the system for immediate arbitrage operations.

### Step 4: MACRO_AGENT Bypass Preservation
Incorporate a conditional override in the arbitrage flow for initiateJulesSession, routing it directly through the MACRO_AGENT pathway without invoking the full governor or pacing checks. This maintains specialized session handling while isolating it from daily spend limits, queried via provider flags in the schema.

## Overall System Flow
- **Request Ingress**: Incoming queries hit the arbitrator, which fetches provider/model states from Prisma.
- **Decision Loop**: Apply 2-Phase Governor to select optimal route; fallback to ZERO_SPEND_PROXY on exhaustion.
- **Post-Routing**: Log costs for balance updates; enforce cooldowns via timestamp checks.
- **Reset Mechanism**: Daily midnight cron-like trigger (architected as a scheduled task) to clear EXHAUSTED flags and recalculate targets.

This architecture ensures scalable, paced arbitrage that maximizes value from promotions without over-spending.

>ROUTED_TO: ENTANGLER
