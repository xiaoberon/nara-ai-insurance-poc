# Nara AI Insurance PoC

> Public interactive demo: [nara-ai-insurance-poc.tangyiris.chatgpt.site](https://nara-ai-insurance-poc.tangyiris.chatgpt.site)

Nara is a fictional insurance-assistant proof of concept built for an internal AI Challenge (1st place). It validates a four-stage decision flow for insurance consultation, voucher eligibility, product recommendation, and product comparison.

## What this demonstrates

- A hybrid decision design: semantic understanding can be handled by an LLM, while eligibility, compliance, pricing, and source validation remain deterministic.
- Three comparable execution modes: `Hybrid`, `Rules Only`, and `LLM Only`.
- Traceable outputs at each stage: structured fields, rule checks, decision reasons, source evidence, and manual-review flags.
- A fixed test set covering normal consultation, missing information, voucher frequency limits, PDP conflicts, and product hard-filtering.

The public site runs entirely with fictional and masked data. It is configured as a **Public Mock Demo** so it exposes no API key, has no paid inference, and does not retain visitor inputs. The underlying `LLMProvider` interface was designed to support a real provider server-side; this repository intentionally defaults to the deterministic mock implementation.

## Four-stage flow

1. **Chat** — converts natural-language needs into a structured `UserNeed` schema and identifies missing information.
2. **Voucher** — applies market, segment, renewal window, budget, frequency, scope, and discount rules before choosing an eligible voucher.
3. **Recommendation** — hard-filters products, then ranks coverage fit (60%) and post-voucher price versus budget (40%).
4. **Comparison** — extracts only visible fictional PDP content, requires evidence for fields, and sends conflicts to manual review rather than guessing.

## Why the three modes matter

The project uses the same cases to make the trade-offs visible:

| Mode | Decision approach |
| --- | --- |
| Hybrid | Semantic understanding with constrained, auditable rule gates for high-risk decisions |
| Rules Only | Deterministic patterns and rules throughout |
| LLM Only | Semantic decisions without the same downstream hard-rule and evidence gates |

The point is not to claim that one model is universally better. It is to show where an LLM adds value, and where product constraints need deterministic control.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

```bash
npm test
npm run build
```

The current suite contains 28 unit and end-to-end checks.

## Data and scope

- All users, vehicles, vouchers, products, and PDP pages are fictional.
- No Shopee, insurer, customer, policy, payment, or underwriting data is included.
- `.env` is excluded from version control. Do not commit provider keys.
- This is a validation prototype, not a production insurance service.

## Structure

```text
src/client/       Interactive React validation surface
src/server/data/  Fictional catalogue, cases, and expectations
src/server/llm/   Provider interface and deterministic mock implementation
src/server/services/
                  Chat, voucher, recommendation, comparison, and evaluation logic
tests/            Unit and end-to-end validation
```
