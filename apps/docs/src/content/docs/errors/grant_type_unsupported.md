---
title: grant_type_unsupported
description: "HTTP 422. The device cannot honour this kind of grant (it is outside the device's `capabilities.supports_grant_types`)."
---

**HTTP status:** 422

## What it means

The device cannot honour this kind of grant (it is outside the device's `capabilities.supports_grant_types`).

## What to do

Choose a grant type the device supports. `GET /devices/{id}` lists them.
