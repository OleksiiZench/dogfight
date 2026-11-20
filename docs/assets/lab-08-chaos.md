# Lab 08 chaos test

| Scenario | Result |
| --- | --- |
| Client kill | room went to 1 player; control p99 1.81 → 1.81 ms |
| Garbage flood | 1000 frames attempted, close 4001, 90 payload rejections; control p99 1.81 → 1.81 ms |
| Server kill | shutdown reason “server shutdown”, close 1001, reconnect after 500 ms, hello true |

Metrics snapshot: {"rooms":2,"players":2,"wsClients":2,"messages":{"in":245,"out":169},"bytes":{"in":15591,"out":426473},"rejections":{"origin":0,"ip_limit":0,"payload":90,"rate_limit":910,"join_timeout":0,"slow_client":0,"policy":0},"ticks":[{"room":"chaos-a","p99DurationMs":2.142112999999995},{"room":"chaos-b","p99DurationMs":1.8136759999999867}],"eventLoopUtilization":1,"rss":147226624}
