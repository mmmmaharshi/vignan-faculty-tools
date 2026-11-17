# 04 — Installed-update lifecycle

Status: resolved
Blocked by: none
Spec: `.scratch/explicit-state-machines/spec.md`

## Task

Model the installed-update flow as one explicit lifecycle: first install,
update downloading, installed and waiting, and active update.

One decision replaces the string state sentinel, the nullable installing and
waiting handles, the controller check, and the two separate transition paths
that currently reach the same offer. The offer still uses the native confirm,
and answering yes still reloads onto the new shell.

The service worker still caches the shell only and never intercepts an API
answer. Its plain JavaScript stays a plain JavaScript file with the same syntax
gate.

## Acceptance

- The lifecycle is a pure decision importable without booting a server.
- Examples and a property join the existing decision and property suites; the
  property is mutation-probed and the probe is recorded.
- The update spec and the PWA spec stay green and unchanged.
- No caching rule, manifest fact, icon, install prompt or ADR changes.

## Do not touch

The app shell, the server, the presentational panels, or any ADR.
