# Contract Risk Radar

Contract Risk Radar is a local-first contract analysis workspace for freelancers, consultants, agencies, and small teams. It turns pasted or uploaded agreement text into a decision brief, risk map, negotiation list, obligations, and renewal/date watchlist.

The first slice is intentionally dependency-free:

- Paste contract text directly.
- Upload `.txt`, `.md`, `.docx`, or text-based `.pdf` files.
- Analyze locally with the built-in v2 risk engine.
- Inspect the animated 3D risk radar, category pressure columns, risk factors, mitigators, obligations, and date watchlist.
- Optionally enable OpenAI Responses API analysis with environment variables.

## Risk Engine

The local analyzer uses a multi-factor scoring model instead of a flat keyword count:

- Clause signals are detected by category, confidence, role sensitivity, and severity.
- Mitigators such as liability caps, payment-gated IP transfer, cure periods, and confidentiality exclusions reduce category pressure.
- Completeness gaps add risk when important guardrails are missing.
- Ambiguity, obligation density, deadline traps, and worst-clause concentration feed the final score.
- Category scores use saturation so one noisy section does not overwhelm the entire document.

The returned analysis includes `factors`, `mitigators`, category momentum, weighted signal load, clause confidence, and negotiation asks.

## Run

```powershell
node apps\contract-risk-radar\src\server.js --port 48910
```

Then open:

```text
http://localhost:48910
```

## Optional OpenAI Analysis

The app works without external services. To route analysis through OpenAI instead of the local engine, set both variables before starting the server:

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="your-preferred-responses-api-model"
node apps\contract-risk-radar\src\server.js --port 48910
```

If the OpenAI call fails, the server falls back to the local analyzer and returns the error in the response metadata.

## Smoke Test

```powershell
node apps\contract-risk-radar\scripts\smoke-test.js
```

The smoke test starts the server, analyzes a deliberately risky sample contract, and checks that the API returns a decision brief with clauses, risk categories, obligations, and negotiation asks.
