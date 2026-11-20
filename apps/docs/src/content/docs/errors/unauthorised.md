---
title: unauthorised
description: "HTTP 401. The request carried no access token, or the token is invalid, expired or revoked."
---

**HTTP status:** 401

## What it means

The request carried no access token, or the token is invalid, expired or revoked.

## What to do

Get a new token from `POST /oauth/token` and send it as `Authorization: Bearer <token>`. Do not retry with the same token.
