# Architecture

FlashForge preserves a mature browser-based study interface inside a small native macOS application. This keeps feature parity while replacing the previous browser-launching shell script with an actual application bundle.

## Components

```text
FlashForge.app
├── AppDelegate              macOS lifecycle and menus
├── MainWindowController     native window state and restoration
├── WebViewController        WebKit, file panels, downloads, first launch
├── FlashForgeCore           testable backup validation and summaries
└── Resources
    ├── index.html           semantic application shell
    ├── app.css              layout, themes, and responsive presentation
    └── app.js               cards, study sessions, stats, and persistence
```

## Storage

Text data is stored in WebKit `localStorage` under versioned keys. Images are compressed in the browser and stored separately in IndexedDB so large collections do not exceed `localStorage` limits.

| Data | Store | Key or database |
| --- | --- | --- |
| Folders, sets, cards | localStorage | `flashforge_v2` |
| Session statistics | localStorage | `flashforge_stats` |
| Per-card mastery | localStorage | `flashforge_card_stats` |
| User preferences | localStorage | `flashforge_settings` |
| Card images | IndexedDB | `flashforge_images` / `imgs` |
| In-progress study session | localStorage | `flashforge_session_<set-id>` |

Complete backup files are portable JSON documents. Images are embedded as data URLs so a single file can restore the entire library.

## Native Boundary

The web application calls standard browser file inputs and download links. `WebViewController` maps those operations to `NSOpenPanel` and `NSSavePanel`, while the native menu invokes the same JavaScript commands exposed by the interface. No private card content crosses the native boundary or leaves the device.

## Design Decisions

- **No third-party dependencies:** AppKit, WebKit, Foundation, and Swift Testing are sufficient.
- **Offline by default:** the app opens bundled resources and external navigation is handed to the user's browser.
- **Migration through backups:** browser-local storage is origin-specific, so the supported migration path is the existing full backup format.
- **Private data excluded:** Git ignores FlashForge exports, and the repository contains no real study material.
