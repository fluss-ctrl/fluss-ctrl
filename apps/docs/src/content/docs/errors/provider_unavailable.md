---
title: provider_unavailable
description: "HTTP 503. The provider is failing, so the command was refused instead of waiting out timeouts."
---

**HTTP status:** 503

## What it means

The provider is failing, so the command was refused instead of waiting out timeouts. Nothing was queued for later. The command was recorded as `rejected`.

## What to do

Retry later. The status page shows provider incidents.
