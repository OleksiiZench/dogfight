# Lab 08 chaos test

| Scenario | Result |
| --- | --- |
| Client kill | room went to 1 player; control p99 0.56 → 0.36 ms |
| Garbage flood | 500 frames over 5000 ms (100/s target), close 4001, 500 payload rejections; control p99 0.47 → 0.26 ms |
| Graceful shutdown | shutdown reason “server shutdown”, close 1001, reconnect after 500 ms, hello true |

Control-room p99 is measured over a fresh 120-tick window per scenario. The shutdown scenario is an in-process graceful close, not an OS-level kill.

Metrics snapshot: {"rooms":2,"players":2,"wsClients":2,"messages":{"in":2339,"out":4345},"bytes":{"in":168174,"out":5126528},"rejections":{"origin":0,"ip_limit":0,"payload":500,"rate_limit":0,"join_timeout":0,"slow_client":0,"policy":0},"ticks":[{"room":"chaos-a","p99DurationMs":0.41219700000146986},{"room":"chaos-b","p99DurationMs":0.26143499999852793}],"eventLoopUtilization":1,"rss":195153920}
