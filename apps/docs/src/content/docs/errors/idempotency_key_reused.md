---
title: idempotency_key_reused
description: "HTTP 422. The `Idempotency-Key` was already used with a different request body."
---

**HTTP status:** 422

## What it means

The `Idempotency-Key` was already used with a different request body.

## What to do

Use a new key for a new request. Reuse a key only to retry the identical request.
