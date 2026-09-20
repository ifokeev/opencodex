# OpenCodex desktop shell

The Tauri shell attaches to the local OpenCodex proxy and keeps the dashboard
in the proxy's loopback origin. During development:

```sh
bun run prepare-sidecar
bun run dev
```

The sidecar is generated from the repository's standalone binary build and is
not checked into git.
