---
title: rate_limited
description: "HTTP 429. The client exceeded its request rate (a token bucket of 50 requests a second, bursts of 200)."
---

**HTTP status:** 429

## What it means

The client exceeded its request rate (a token bucket of 50 requests a second, bursts of 200).

## What to do

Wait for the number of seconds in `Retry-After`, then retry. The request did not happen.
