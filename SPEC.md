# EVAIX Core Specification

## Core Axioms
- **Headless CLI:** EVAIX Core is a pure Node.js/TypeScript CLI and daemon system. There is absolutely NO GUI. Technologies such as React, Next.js, Vite, HTML, or CSS are strictly prohibited.
- **Git as Context:** The system uses Git to track state and context. The repository's state is the single source of truth for all agents.
- **No Solo Agents:** The system strictly uses a predefined Minimum Viable Team. Monolithic solo agents are not permitted.

## The Entangled Architecture
EVAIX Core operates on an Entangled Architecture, which means the system runs by parsing Markdown files. Agents communicate by writing prose and embedding executable operations directly within the text.
- **Command Execution:** Executable shell commands must be strictly prefixed with `>CMD:`.
- **Code Execution:** TypeScript code must be enclosed within standard ````typescript```` blocks.
The Kernel continuously watches and parses these Markdown files, extracting and executing the embedded commands and code blocks.

## The Arbitrage Routing
The Arbitrage Routing system dictates how language models are vetted, selected, and assigned to specific tasks. Models are routed based on their suitability for the requested operation, balancing performance, cost, and speed. Models that fail tasks repeatedly are monitored by the Auditor, and their tasks can be revoked and reassigned to maintain system stability and efficiency.