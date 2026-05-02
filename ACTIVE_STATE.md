>INTENT: Design the generalized Arbitrage Engine with Daily Pacing. 1. Update Prisma schema: Providers need BaseUrl, AuthEnvKey, RiskProfile, PromoBalance, and BillingCycleEnd. Models need CooldownUntil, InputCostPerM, OutputCostPerM. 2. Plan src/arbitrage.ts with a 2-Phase Governor: Phase 1 sprints to a  threshold to unlock promos. Phase 2 dynamically calculates DailySpendTarget (Remaining PromoBalance / Days Until BillingCycleEnd). If the daily target is reached, flag the provider as EXHAUSTED until midnight and route to ZERO_SPEND_PROXY. 3. Create a seed script (src/seed-models.ts) for the full xAI fleet (grok-3, grok-4-fast, etc.) and prices. 4. Maintain the MACRO_AGENT bypass for initiateJulesSession. Follow Architect planning rules strictly and end with >ROUTED_TO: ENTANGLER.
>ROUTED_TO: ARCHITECT_PLANNING

>AUDIT_ALERT: Courier LLM API Routing failed completely.
```text
HTTP 404: Not Found
```

>AUDIT_ALERT: Courier LLM API Routing failed completely.
```text
HTTP 404: Not Found
```
