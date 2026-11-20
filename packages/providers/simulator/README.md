# @flussctrl/provider-simulator

The reference provider (SPEC §10.2). Every sandbox organisation uses it, and the conformance kit
runs against it in CI. It talks to no network and needs no credentials.

| | |
|---|---|
| Code | `simulator` |
| Onboarding | `claim_code` (any code; claim arrives with Phase 1 onboarding) |
| Stability | `official` |
| Credentials | none |
| Rate limits | none beyond the platform's 2 s minimum command interval |

## Device configuration

`DeviceRef.config` is `{ behaviour }`, validated by `simulatorConfigSchema`. Every field is optional:

| Field | Default | Meaning |
|---|---|---|
| `online` | `true` | `false` reads offline and refuses every command as `offline` |
| `verification_level` | `status` | `none`, `ack` or `status`; `status` needs a status model |
| `latency_ms` | `300` | waited on every status read and send |
| `fail_rate` | `0` | chance (0–1) a send without `params.simulate` fails as `vendor_error` without moving the gate |
| `status_model` | `gate_slow` | `gate_slow`, `door_lock` (moves at once), or `none` (reads `unknown`) |
| `pulse_mode` | `toggle` | `toggle` or `open_only` (SPEC §4 `controls.pulse_mode`) |
| `autoclose_s` | `15` | seconds a fully open gate waits before closing itself; `null` for none |
| `travel_s` | `12` | full travel time |
| `initial_state` | `closed` | where the device starts the first time it is touched |

## The gate model

Every action is one pulse on the motor (`src/gate.ts`). The coordinator checks the state before an
`open` or `close`, so the simulator does not.

- `toggle`: a pulse on a stationary gate moves it the other way; a pulse on a moving gate stops
  it, and the next pulse reverses it. A stopped gate does not autoclose.
- `open_only`: a pulse opens or re-opens the gate, and restarts autoclose on an open gate. Only
  autoclose closes it, so `close` is never offered and is refused as `unsupported`.
- Status reads `closed` only when the gate is stationary at the end of its travel, and `open`
  otherwise, like a loop-back status input.

The model is pure and evaluated lazily at the injected clock's time, so tests jump to any instant
and nothing runs on a timer. fast-check properties in `src/gate.test.ts` cover it.

## Forced outcomes

Pass `params.simulate` on a command:

| Value | Result | Gate moves |
|---|---|---|
| `timeout` | waits `send_s` (8 s), then `timeout`, ambiguous | no |
| `ambiguous` | `timeout`, ambiguous (the reply was lost) | yes |
| `offline` | `offline` | no |
| `reject` | `vendor_error` | no |
| `no_status` | acked as for any send (not at level `none`); status reads `unknown` until the next command | yes |

## Quirks

- The simulated hardware lives in memory in each `createSimulator()` instance, keyed by device id.
  A new instance, or `unlinkDevice`, starts the device again from `initial_state`.
- Pass `clock` (a `ManualClock` from `@flussctrl/core` in tests) and `random` for deterministic runs.
- Provider-originated events on a timer (SPEC §10.2) arrive with ingest, not in Phase 0.

## Conformance

`packages/conformance/src/simulator.conformance.test.ts` runs the kit against the default device
and against `open_only`, door-lock and ack-only devices. It must pass at 100%.
