# OpenCodex desktop shell

The Tauri shell attaches to the local OpenCodex proxy and keeps the dashboard
in the proxy's loopback origin. During development:

```sh
bun run prepare-sidecar
bun run prepare-widget
bunx tauri dev
```

The sidecar is generated from the repository's standalone binary build and is
not checked into git.

The CI desktop-shell job performs Rust-only checks. It creates an empty
platform-named sidecar stub and a placeholder dashboard resource directory
solely for Tauri's external-binary and resource validation; it does not build
or run the standalone binary.

For a macOS release build, prepare the sidecar and WidgetKit extension before invoking
Tauri:

```sh
bun run prepare-sidecar
bun run prepare-widget
bunx tauri build
```
