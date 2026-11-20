---
title: command_rate_limited
description: "HTTP 409. The command arrived inside the device's minimum interval (2 seconds unless the provider declares a lower safe one)."
---

**HTTP status:** 409

## What it means

The command arrived inside the device's minimum interval (2 seconds unless the provider declares a lower safe one). The command was recorded as `rejected`.

## What to do

Wait for the interval and send again. Do not retry a `trigger` blindly: a second pulse can undo the first.
