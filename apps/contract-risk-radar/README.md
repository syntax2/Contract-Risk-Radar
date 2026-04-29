# Contract Risk Radar

Contract Risk Radar is a local-first contract analysis workspace for freelancers, consultants, agencies, and small teams. It turns pasted or uploaded agreement text into a trust brief with source-grounded evidence, uncertainty, negotiation asks, obligations, and renewal/date watchlist.

The first slice is intentionally dependency-free:

- Paste contract text directly.
- Upload `.txt`, `.md`, `.docx`, or text-based `.pdf` files.
- Recover PDF text with a stream decoder that reads text operators, hex/literal strings, stream filters, page count, and extraction coverage.
- Analyze locally with Ollama when it is running.
- Fall back to the built-in v2 risk engine when Ollama is unavailable.
- Inspect the pipeline: extraction, LLM input packet, final report, evidence ledger, uncertainty list, category pressure rows, mitigators, obligations, and date watchlist.

## Risk Engine

The local analyzer uses a multi-factor scoring model instead of a flat keyword count:

- Clause signals are detected by category, confidence, role sensitivity, and severity.
- Mitigators such as liability caps, payment-gated IP transfer, cure periods, and confidentiality exclusions reduce category pressure.
- Completeness gaps add risk when important guardrails are missing.
- Ambiguity, obligation density, deadline traps, and worst-clause concentration feed the final score.
- Category scores use saturation so one noisy section does not overwhelm the entire document.

The returned analysis includes `factors`, `mitigators`, category momentum, weighted signal load, clause confidence, negotiation asks, and a `trust` block with evidence, uncertainty, method, and source-quality notes.

## Analysis Pipeline

The app now separates the analysis into three explicit algorithms:

1. `extractTextFromUpload` recovers document text. For PDFs it decodes content streams, reads `Tj`, `TJ`, quote, hex, and literal text operators, and reports page/coverage metadata.
2. `buildLlmInputPacket` converts the extracted text into an LLM-ready packet with source quality, section excerpts, deterministic evidence, missing guardrails, and model questions.
3. `analyzeWithOllama` asks the local model to create the final report judgment from that packet, while the deterministic evidence ledger remains available for auditability.

## Local AI With Ollama

Start Ollama before analyzing documents:

```powershell
ollama serve
```

Install or choose a model:

```powershell
ollama pull llama3.1:8b
$env:OLLAMA_MODEL="llama3.1:8b"
node apps\contract-risk-radar\src\server.js --port 48910
```

If `OLLAMA_MODEL` is not set, the server uses the first installed Ollama model from `http://127.0.0.1:11434/api/tags`.

## Run

```powershell
node apps\contract-risk-radar\src\server.js --port 48910
```

Then open:

```text
http://localhost:48910
```

## Optional OpenAI Analysis

The app works without external cloud services. The older OpenAI path remains available for experimentation, but the default user flow is local Ollama analysis.

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
