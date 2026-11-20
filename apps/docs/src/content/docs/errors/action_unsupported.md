---
title: action_unsupported
description: "HTTP 422. The device does not support this action."
---

**HTTP status:** 422

## What it means

The device does not support this action. It is not in the device's `capabilities.actions`; for example, `close` is not offered on a gate whose pulse can only open it. The command was recorded as `rejected`.

## What to do

Use an action the device lists.
