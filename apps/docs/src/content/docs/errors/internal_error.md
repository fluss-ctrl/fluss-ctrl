---
title: internal_error
description: "HTTP 500. Something failed inside Fluss Ctrl."
---

**HTTP status:** 500

## What it means

Something failed inside Fluss Ctrl. The request may not have completed.

## What to do

Retry with the same `Idempotency-Key` where the endpoint takes one, so a retry cannot act twice. Quote `request_id` if you contact support.
