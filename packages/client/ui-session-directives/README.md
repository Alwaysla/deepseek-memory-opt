# `@deepseek-ai/dsh-client-ui-session-directives`

English | [中文](README.zh.md)

Client plugin that adds a **Directives** tab beside Chat and Trajectory. It reads the Host-computed `sessionDirectives` projection and performs mutations through the existing session command RPC.

## Projection and commands

The projection is a whole value `{ directives }`; each entry has `key`, `value`, `source`, and the literal scope `session`. The view executes `/directive set <key> <JSON value>`, `/directive delete <key>`, and `/directive clear`. The Host remains authoritative: successful commands become visible only when the projection updates.

Every entry exposes edit and delete controls. The header exposes add and clear controls. Command admission and transport failures remain visible in the tab.

## Model Experience

Indirectly, through the Host session-directives capability whose projection this package displays and edits.

#### KV Cache effect

This Client package has no direct effect on model requests or KV-cache reuse.

## Known Limitations and Deferred Work

- **Host capability is optional** — when `sessionDirectives` or `/directive` is absent, the tab shows an empty state or the command failure; the Client does not emulate persistence.
