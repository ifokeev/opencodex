# Desktop shell

The `desktop/` tree owns the Tauri v2 OpenCodex desktop shell. Its Rust crate
discovers the loopback proxy, lazily retries management authentication, starts
the bundled `ocx` sidecar only when the configured endpoint is unreachable,
and owns the tray, autostart, single-instance, and window lifecycle behavior.

`desktop/ui/` is only a short bootstrap page. Once `/healthz` answers, the shell
navigates the webview to the proxy's loopback dashboard
(`/#/usage`) rather than bundling or serving `gui/dist` itself.
Only the bootstrap page has Tauri IPC capability; the loopback dashboard never
does because `dangerousRemoteDomainIpcAccess` is not configured.

`desktop/scripts/prepare-sidecar.ts` maps Rust target triples to the standalone
Bun targets and prepares the external binary plus dashboard resources used by
Tauri. Generated files under desktop/src-tauri/binaries/ and
desktop/src-tauri/resources/ remain ignored.

The management API companion presence check in
`src/server/management/companion-routes.ts` accepts both
`OpenCodexMenuBar/` and `OpenCodexDesktop/` user agents. This is presence
telemetry only; management authentication remains in the shared API boundary.
The desktop webview uses a Mozilla-compatible `OpenCodexDesktop/` user-agent
marker, which the GUI detects to identify the shell without using IPC.
