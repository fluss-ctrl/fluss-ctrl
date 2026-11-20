---
title: service_unavailable
description: "HTTP 503. Fluss Ctrl cannot reach its database."
---

**HTTP status:** 503

## What it means

Fluss Ctrl cannot reach its database. Commands and grant writes are refused rather than queued, because a gate that opens ten minutes late is worse than a clear failure.

## What to do

Retry after the number of seconds in `Retry-After`. Nothing was queued for later.
