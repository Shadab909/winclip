<div align="center">
  <h1>WinClip</h1>
  <p><strong>Windows-style clipboard history for GNOME Shell</strong></p>
  <p>
    <img src="https://img.shields.io/badge/GNOME-46-blue.svg">
    <img src="https://img.shields.io/badge/platform-Ubuntu%2024.04-orange.svg">
    <img src="https://img.shields.io/badge/session-X11-purple.svg">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg"></a>
    <a href="https://github.com/Shadab909/winclip/releases"><img src="https://img.shields.io/github/v/release/Shadab909/winclip"></a>
  </p>
</div>

> ⚠️ **X11 only** — This extension requires an X11 session. Wayland is not supported.
> On Ubuntu 24.04, select "Ubuntu on Xorg" at the login screen.

A GNOME Shell extension that adds a **Windows-style clipboard history** to your desktop. Press **Super+V** to open a floating dialog showing your clipboard history — text and images. Click any entry to paste it into the currently focused app.

## Features

- 📋 **Clipboard history** — automatically records text and images
- 🖼 **Image support** — thumbnails for copied images
- 🔍 **Search** — filter history with the search bar
- 📌 **Pin items** — pinned entries stay at the top and survive eviction
- ⌨️ **Keyboard driven** — navigate with arrows, paste with Enter, close with Escape
- 💾 **Persistent** — history survives GNOME Shell restarts
- ⚙️ **Configurable** — max items via preferences page
- 🧹 **Clean disable** — removes all signals, shortcuts, and UI on disable


## ⚠️ Before You Install — Disable Conflicting Shortcut

Ubuntu 24.04 assigns `Super+V` to the **notification tray** by default. You must disable this before WinClip can capture it.

**Disable via terminal:**
```bash
gsettings set org.gnome.shell.keybindings toggle-message-tray "[]"
```

**To restore it later if you uninstall WinClip:**
```bash
gsettings set org.gnome.shell.keybindings toggle-message-tray "['<Super>v']"
```

> After disabling, restart GNOME Shell (`Alt+F2` → `r` → Enter) for the change to take effect.

## Installation

### Option 1 — Direct install (recommended)
```bash
wget https://github.com/Shadab909/winclip/releases/latest/download/winclip@Shadab909.github.io.zip

gnome-extensions install "winclip@Shadab909.github.io.zip" --force
```

Then restart GNOME Shell — press `Alt+F2` or `Fn+Alt+F2`, type `r`, press Enter (X11 only).

Enable the extension:
```bash
gnome-extensions enable winclip@Shadab909.github.io
```

**Runtime dependency:**
```bash
sudo apt install xdotool
```

---

### Option 2 — Build from source (developers)
```bash
# Install build dependencies
sudo apt install nodejs npm glib-2.0-dev xdotool

# Clone and build
git clone https://github.com/Shadab909/winclip.git
cd winclip
make install
```

Then restart GNOME Shell and enable as above.

### Uninstall
```bash
gnome-extensions disable winclip@Shadab909.github.io
gnome-extensions uninstall winclip@Shadab909.github.io
```

## Usage

| Action | How |
|--------|-----|
| Open/Close clipboard history | `Super+V` |
| Search | Type in the search bar |
| Paste an item | Click it, or navigate with ↑↓ and press Enter |
| Pin/unpin | Click the ⭐ icon |
| Delete an item | Click the 🗑 icon, or focus + press Delete |
| Clear unpinned | Click the trash icon in the header |

## Preferences

Open the preferences dialog:

```bash
gnome-extensions prefs winclip@Shadab909.github.io
```

Available settings:
- **Maximum History Items** (10–200, default 50)

## Project Structure

```
clipboard/
├── src/
│   ├── extension.ts      # Extension enable/disable lifecycle
│   ├── prefs.ts           # GTK4/Adw preferences page
│   ├── clipboardManager.ts # Clipboard monitoring (Meta.Selection)
│   ├── historyManager.ts  # Persistent history storage
│   ├── clipboardDialog.ts # Floating dialog UI (St widgets)
│   └── utils.ts           # Shared utilities
├── schemas/
│   └── org.gnome.shell.extensions.winclip.gschema.xml
├── stylesheet.css         # St widget styles
├── metadata.json          # Extension metadata
├── esbuild.js             # Build configuration
├── tsconfig.json          # TypeScript configuration
├── package.json           # Dev dependencies
├── Makefile               # Build & install
└── README.md              # This file
```

## Data Storage

History is stored at:
- Text entries: `~/.local/share/winclip/history.json`
- Image blobs: `~/.local/share/winclip/images/`

## Tech Stack

- **TypeScript** with **esbuild** (ESM, target: firefox115)
- **GNOME Shell 46** ESModules API
- **St** (Shell Toolkit) for UI widgets
- **Meta.Selection** for clipboard monitoring
- **xdotool** for X11 paste simulation
- **GSettings** (extension-local schema, no system-wide changes)

## License

MIT
