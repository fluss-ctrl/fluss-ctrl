---
title: device_offline
description: "HTTP 409. The controller is known to be offline, so the command was not sent."
---

**HTTP status:** 409

## What it means

The controller is known to be offline, so the command was not sent. The command was recorded as `rejected`; `command_id` identifies it. A device found offline after acceptance ends `rejected` with this same `error_code`.

## What to do

Check the device's connectivity. Retry once it reports online.
