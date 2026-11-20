---
title: Errors
description: "Error responses and the stable codes they carry."
---

Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details with
`Content-Type: application/problem+json`:

```json
{ "type": "https://docs.flussctrl.com/errors/device_offline",
  "title": "Device offline", "status": 409,
  "code": "device_offline", "detail": "…", "request_id": "req_…" }
```

- `code` is the contract. Branch on it. `title` and `detail` are for people and may change.
- `request_id` matches the `X-Request-Id` header that every response carries. Quote it when you
  contact support.
- An error status means the request did not happen. A rejected command still carries `command_id`,
  because every attempt is recorded in the log.

Each code has its own page in this section.
