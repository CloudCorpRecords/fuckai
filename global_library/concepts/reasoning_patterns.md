# LLM Reasoning Patterns

## Summary
Common patterns for improving LLM performance on complex tasks. These go beyond simple prompting into architectural structures like Chain of Thought, Tree of Thoughts, and Agentic loops.

## Key Claims
- **Chain of Thought (CoT)**: Forcing the model to output intermediate steps before the final answer.
- **ReAct (Reason + Act)**: A pattern where the model reasons about a step, acts (uses a tool), and then observes the result.
- **Self-Correction**: Prompting the model to review its own output for errors.
- **Agentic Loops**: Iterative cycles where the LLM uses external tools to gather information and update its plan.

## Connections
- [[concepts/llm_wiki]] — reasoning patterns are used to compile knowledge into the wiki.
- [[topics/agentic_ai]] — the field where these patterns are most critical.

## Contradictions
- Reasoning patterns increase token cost and latency.
- "Reasoning" in LLMs is statistical, not symbolic; it can still fail on simple logic.

## Sources
- Wei et al. "Chain of Thought Prompting Elicits Reasoning in Large Language Models"
- Yao et al. "ReAct: Synergizing Reasoning and Acting in Language Models"

---
*Global Library — Shared Pattern*
