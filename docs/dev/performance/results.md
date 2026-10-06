# QA comparison, 6 October 2026

Baseline: `origin/qa` at `2ff44480efcc86fce6224597f7c91c8d938151ce`. Candidate: `perf/chat-model-loading`. Reproduce with the commands in [README.md](README.md). These are synthetic, isolated fixtures, not production measurements.

| Measurement | QA | Candidate |
| --- | ---: | ---: |
| Cold model HTTP response p95, 64 concurrent clients | 250.8 ms | 12.7 ms |
| Forced-refresh model HTTP response p95, 64 clients | 225.0 ms | 10.7 ms |
| Streaming update batch p95, 100 loaded turns / 4,000 deltas | 12.18 ms | 0.37 ms |
| Search folding retained JS heap, 100 distinct large texts | 231.0 MB | 0.079 MB |
| Log-tail read median, normal final event in 32 MiB log | 20.16 ms | 0.037 ms |
| Log-tail allocation per read | 16.79 MB | 0.005 MB |
| Chromium retained JS heap after navigation and telemetry fixture | 58.7 MB | 5.9 MB |

All 192 model requests per version succeeded. Cold and refresh waves each shared one actual probe per provider. Candidate progressive response timings measure availability of a partial/cached catalog: the deliberately slow provider still takes 200 ms to discover. They do not imply that discovery itself became faster.

The Chromium fixture uses 1,000 chat metadata records, 12 chat/project-settings navigation cycles, and 100 unique 512 KB native telemetry events. Both versions reported zero page errors. Candidate avoids loading secrets, access, shares and application lists when visiting Settings. The full Info inspection and lightweight Settings request remain distinct requests.

End-to-end navigation timings did **not** improve in this harness; a second sequential run reproduced slower candidate cycles. These include browser action waits, rendering and mocked requests, and require further profiling on QA before claiming a navigation latency win. The heap reduction reproduced in the second run (58.74 MB versus 5.86 MB).

JS heap is not total tab memory. These tests cannot confirm or promise a particular reduction from the reported 729 MB browser task-manager figure. Real-session heap snapshots and network traces remain necessary to evaluate image/GPU/DOM/browser overhead and actual project/container latency.

The separate `fix/preserve-chat-drafts` branch passed a Chromium navigation/reload scenario: unsent text and uploaded images survived three navigation cycles, an in-flight upload completed once without navigation-triggered deletion, and explicit removal stayed removed after reload. Completed upload metadata survives reload; an unfinished upload cannot continue across a full browser reload.

The machine-readable comparison is generated at `.performance/qa-comparison/report.json` locally and is intentionally excluded from Git. Browser fixtures and load-test scripts are committed so reviewers can regenerate results.
