# Fraud Detection Scripts

These scripts are intentionally split by detection domain. Keep new detectors
in the narrowest folder that matches the behavior they inspect.

- `accounts/`: mock account integrity, resets, restrictions, and adjustment abuse.
- `sessions/`: auth/session/device anomalies.
- `leaderboard/`: ranking, portfolio snapshot, and leaderboard eligibility abuse.
- `trading/`: order, trade, market manipulation, wash trading, and collusion checks.
- `shared/`: common script helpers only.

All detectors are read-only unless run with `--persist`, which writes matching
findings into `fraud_alerts`.

Common options:

```bash
bun run fraud:all
bun run fraud:account-integrity
bun run fraud:sessions
bun run fraud:leaderboard -- --window-hours=24 --min-score=60 --limit=100
bun run fraud:leaderboard:portfolio
bun run fraud:trades
bun run fraud:trading:collusion
bun run fraud:market-manipulation
bun run fraud:leaderboard -- --persist
```
