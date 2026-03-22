// src/extension.ts
import Meta2 from "gi://Meta";
import Shell2 from "gi://Shell";
import * as Main2 from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// src/clipboardManager.ts
import GLib2 from "gi://GLib";
import Meta from "gi://Meta";
import St from "gi://St";
import Shell from "gi://Shell";

// src/utils.ts
import Gio from "gi://Gio";
import GLib from "gi://GLib";
function getDataDir() {
  return GLib.build_filenamev([GLib.get_user_data_dir(), "winclip"]);
}
function getImagesDir() {
  return GLib.build_filenamev([getDataDir(), "images"]);
}
function getHistoryFilePath() {
  return GLib.build_filenamev([getDataDir(), "history.json"]);
}
function ensureDirectory(path) {
  const dir = Gio.File.new_for_path(path);
  if (!dir.query_exists(null)) {
    dir.make_directory_with_parents(null);
  }
}
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
function truncateText(text, maxLen) {
  const singleLine = text.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLen) {
    return singleLine;
  }
  return singleLine.substring(0, maxLen) + "\u2026";
}
function debug(msg) {
  console.log(`[WinClip] ${msg}`);
}

// src/clipboardManager.ts
var ContentType = {
  TEXT: 0,
  IMAGE: 1,
  FILE: 2
};
var TEXT_MIME_TYPES = ["text/plain", "text/plain;charset=utf-8", "UTF8_STRING"];
var IMAGE_MIME_TYPES = ["image/png"];
var FILE_MIME_TYPES = ["x-special/gnome-copied-files"];
function hasMimeType(clipboardMimeTypes, targetMimeTypes) {
  return clipboardMimeTypes.some((m) => targetMimeTypes.includes(m));
}
function getMatchingMimeType(clipboardMimeTypes, targetMimeTypes) {
  return clipboardMimeTypes.find((m) => targetMimeTypes.includes(m));
}
var ClipboardManager = class {
  _clipboard;
  _selection;
  _selectionChangedId = null;
  _lastText = null;
  _lastImageHash = 0;
  _lastFileContent = null;
  _isTracking = false;
  _changeCallbacks = [];
  constructor() {
    this._clipboard = St.Clipboard.get_default();
    this._selection = Shell.Global.get().get_display().get_selection();
  }
  /**
   * Register a callback for clipboard changes.
   */
  onChanged(callback) {
    this._changeCallbacks.push(callback);
  }
  /**
   * Start tracking clipboard changes.
   */
  startTracking() {
    if (this._isTracking) return;
    this._isTracking = true;
    this._selectionChangedId = this._selection.connect(
      "owner-changed",
      (_selection, selectionType, _source) => {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
          GLib2.timeout_add(GLib2.PRIORITY_DEFAULT, 100, () => {
            this._readClipboard();
            return GLib2.SOURCE_REMOVE;
          });
        }
      }
    );
    debug("Clipboard tracking started");
  }
  /**
   * Stop tracking clipboard changes.
   */
  stopTracking() {
    if (this._selectionChangedId !== null) {
      this._selection.disconnect(this._selectionChangedId);
      this._selectionChangedId = null;
    }
    this._isTracking = false;
    this._lastText = null;
    this._lastImageHash = 0;
    this._lastFileContent = null;
    debug("Clipboard tracking stopped");
  }
  /**
   * Write text to the system clipboard.
   */
  setTextContent(text) {
    this._lastText = text;
    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
  }
  /**
   * Write image bytes (PNG) to the system clipboard.
   */
  setImageContent(imageBytes) {
    this._lastImageHash = this._simpleHash(imageBytes);
    this._clipboard.set_content(
      St.ClipboardType.CLIPBOARD,
      IMAGE_MIME_TYPES[0],
      new GLib2.Bytes(imageBytes)
    );
  }
  /**
   * Write file clipboard content (x-special/gnome-copied-files) back to clipboard.
   */
  setFileContent(fileContent) {
    this._lastFileContent = fileContent;
    this._clipboard.set_content(
      St.ClipboardType.CLIPBOARD,
      FILE_MIME_TYPES[0],
      new GLib2.Bytes(new TextEncoder().encode(fileContent))
    );
  }
  /**
   * Destroy the clipboard manager and release all resources.
   */
  destroy() {
    this.stopTracking();
    this._changeCallbacks = [];
  }
  // ------- Private -------
  _readClipboard() {
    try {
      const mimeTypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
      if (hasMimeType(mimeTypes, FILE_MIME_TYPES)) {
        const mime = getMatchingMimeType(mimeTypes, FILE_MIME_TYPES);
        if (!mime) return;
        this._clipboard.get_content(
          St.ClipboardType.CLIPBOARD,
          mime,
          (_clipboard, bytes) => {
            try {
              const data = bytes instanceof GLib2.Bytes ? bytes.get_data() : bytes;
              if (data && data.length > 0) {
                const content = new TextDecoder().decode(data);
                if (content === this._lastFileContent) return;
                this._lastFileContent = content;
                this._lastText = null;
                this._lastImageHash = 0;
                const entry = {
                  type: ContentType.FILE,
                  fileContent: content
                };
                this._emitChanged(entry);
              }
            } catch (e) {
              debug(`Error reading file clipboard: ${e}`);
            }
          }
        );
      } else if (hasMimeType(mimeTypes, IMAGE_MIME_TYPES)) {
        const mime = getMatchingMimeType(mimeTypes, IMAGE_MIME_TYPES);
        if (!mime) return;
        this._clipboard.get_content(
          St.ClipboardType.CLIPBOARD,
          mime,
          (_clipboard, bytes) => {
            try {
              const data = bytes instanceof GLib2.Bytes ? bytes.get_data() : bytes;
              if (data && data.length > 0) {
                const hash = this._simpleHash(data);
                if (hash === this._lastImageHash) return;
                this._lastImageHash = hash;
                this._lastText = null;
                this._lastFileContent = null;
                const entry = {
                  type: ContentType.IMAGE,
                  imageBytes: data
                };
                this._emitChanged(entry);
              }
            } catch (e) {
              debug(`Error reading image clipboard: ${e}`);
            }
          }
        );
      } else if (hasMimeType(mimeTypes, TEXT_MIME_TYPES)) {
        this._clipboard.get_text(
          St.ClipboardType.CLIPBOARD,
          (_clipboard, text) => {
            try {
              if (text && text.trim()) {
                if (text === this._lastText) return;
                this._lastText = text;
                this._lastImageHash = 0;
                this._lastFileContent = null;
                const entry = {
                  type: ContentType.TEXT,
                  text
                };
                this._emitChanged(entry);
              }
            } catch (e) {
              debug(`Error reading text clipboard: ${e}`);
            }
          }
        );
      }
    } catch (e) {
      debug(`Error in _readClipboard: ${e}`);
    }
  }
  _emitChanged(entry) {
    for (const cb of this._changeCallbacks) {
      try {
        cb(entry);
      } catch (e) {
        debug(`Error in clipboard change callback: ${e}`);
      }
    }
  }
  /**
   * Simple hash for deduplication of byte arrays.
   */
  _simpleHash(data) {
    let hash = 0;
    const step = Math.max(1, Math.floor(data.length / 1e3));
    for (let i = 0; i < data.length; i += step) {
      hash = (hash << 5) - hash + data[i] | 0;
    }
    return hash;
  }
};

// src/historyManager.ts
import Gio2 from "gi://Gio";
import GLib3 from "gi://GLib";
var HistoryManager = class {
  _entries = [];
  _maxItems;
  _saveTimeoutId = null;
  constructor(maxItems) {
    this._maxItems = maxItems;
    ensureDirectory(getDataDir());
    ensureDirectory(getImagesDir());
    this._load();
  }
  /**
   * Set the maximum number of history items (pinned items are exempt from eviction).
   */
  setMaxItems(maxItems) {
    this._maxItems = maxItems;
    this._evict();
    this._scheduleSave();
  }
  /**
   * Add a new clipboard entry to history.
   * Returns the created HistoryEntry.
   */
  addEntry(clipEntry) {
    const entry = {
      id: generateId(),
      type: clipEntry.type,
      pinned: false,
      timestamp: Date.now()
    };
    if (clipEntry.type === ContentType.TEXT && clipEntry.text) {
      const existingIndex = this._entries.findIndex(
        (e) => e.type === ContentType.TEXT && e.text === clipEntry.text
      );
      if (existingIndex >= 0) {
        const existing = this._entries[existingIndex];
        this._entries.splice(existingIndex, 1);
        existing.timestamp = Date.now();
        this._entries.unshift(existing);
        this._scheduleSave();
        return existing;
      }
      entry.text = clipEntry.text;
    } else if (clipEntry.type === ContentType.IMAGE && clipEntry.imageBytes) {
      const imagePath = GLib3.build_filenamev([getImagesDir(), `${entry.id}.png`]);
      try {
        const file = Gio2.File.new_for_path(imagePath);
        const stream = file.replace(null, false, Gio2.FileCreateFlags.NONE, null);
        stream.write_bytes(new GLib3.Bytes(clipEntry.imageBytes), null);
        stream.close(null);
        entry.imagePath = imagePath;
      } catch (e) {
        debug(`Error saving image: ${e}`);
        return entry;
      }
    } else if (clipEntry.type === ContentType.FILE && clipEntry.fileContent) {
      const existingIndex = this._entries.findIndex(
        (e) => e.type === ContentType.FILE && e.text === clipEntry.fileContent
      );
      if (existingIndex >= 0) {
        const existing = this._entries[existingIndex];
        this._entries.splice(existingIndex, 1);
        existing.timestamp = Date.now();
        this._entries.unshift(existing);
        this._scheduleSave();
        return existing;
      }
      entry.text = clipEntry.fileContent;
    }
    this._entries.unshift(entry);
    this._evict();
    this._scheduleSave();
    return entry;
  }
  /**
   * Remove a history entry by ID.
   */
  removeEntry(id) {
    const index = this._entries.findIndex((e) => e.id === id);
    if (index >= 0) {
      const entry = this._entries[index];
      if (entry.imagePath) {
        try {
          const file = Gio2.File.new_for_path(entry.imagePath);
          if (file.query_exists(null)) {
            file.delete(null);
          }
        } catch (e) {
          debug(`Error deleting image: ${e}`);
        }
      }
      this._entries.splice(index, 1);
      this._scheduleSave();
    }
  }
  /**
   * Toggle pin status of a history entry.
   */
  togglePin(id) {
    const entry = this._entries.find((e) => e.id === id);
    if (entry) {
      entry.pinned = !entry.pinned;
      this._scheduleSave();
      return entry.pinned;
    }
    return false;
  }
  /**
   * Get all history entries, optionally filtered by a search query.
   * Pinned items always appear at the top.
   */
  getEntries(searchQuery) {
    let entries = [...this._entries];
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      entries = entries.filter((e) => {
        if ((e.type === ContentType.TEXT || e.type === ContentType.FILE) && e.text) {
          return e.text.toLowerCase().includes(query);
        }
        return false;
      });
    }
    entries.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.timestamp - a.timestamp;
    });
    return entries;
  }
  /**
   * Get a single entry by ID.
   */
  getEntry(id) {
    return this._entries.find((e) => e.id === id);
  }
  /**
   * Read image bytes for a history entry.
   */
  getImageBytes(entry) {
    if (!entry.imagePath) return null;
    try {
      const file = Gio2.File.new_for_path(entry.imagePath);
      if (!file.query_exists(null)) return null;
      const [ok, contents] = file.load_contents(null);
      if (ok && contents) {
        return contents;
      }
    } catch (e) {
      debug(`Error reading image: ${e}`);
    }
    return null;
  }
  /**
   * Destroy: flush pending saves.
   */
  destroy() {
    if (this._saveTimeoutId !== null) {
      GLib3.Source.remove(this._saveTimeoutId);
      this._saveTimeoutId = null;
    }
    this._save();
  }
  // ------- Private -------
  _load() {
    try {
      const historyPath = getHistoryFilePath();
      const file = Gio2.File.new_for_path(historyPath);
      if (!file.query_exists(null)) {
        this._entries = [];
        return;
      }
      const [ok, contents] = file.load_contents(null);
      if (ok && contents) {
        const text = new TextDecoder().decode(contents);
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          this._entries = parsed;
          this._entries = this._entries.filter((e) => {
            if (e.type === ContentType.IMAGE && e.imagePath) {
              const imgFile = Gio2.File.new_for_path(e.imagePath);
              return imgFile.query_exists(null);
            }
            return true;
          });
        }
      }
    } catch (e) {
      debug(`Error loading history: ${e}`);
      this._entries = [];
    }
  }
  _save() {
    try {
      ensureDirectory(getDataDir());
      const historyPath = getHistoryFilePath();
      const file = Gio2.File.new_for_path(historyPath);
      const data = JSON.stringify(this._entries, null, 2);
      const stream = file.replace(null, false, Gio2.FileCreateFlags.NONE, null);
      stream.write_bytes(new GLib3.Bytes(new TextEncoder().encode(data)), null);
      stream.close(null);
    } catch (e) {
      debug(`Error saving history: ${e}`);
    }
  }
  _scheduleSave() {
    if (this._saveTimeoutId !== null) return;
    this._saveTimeoutId = GLib3.timeout_add(GLib3.PRIORITY_DEFAULT, 500, () => {
      this._save();
      this._saveTimeoutId = null;
      return GLib3.SOURCE_REMOVE;
    });
  }
  /**
   * Evict oldest non-pinned items if over max.
   */
  _evict() {
    const unpinned = this._entries.filter((e) => !e.pinned);
    const pinned = this._entries.filter((e) => e.pinned);
    if (unpinned.length > this._maxItems) {
      unpinned.sort((a, b) => b.timestamp - a.timestamp);
      const toRemove = unpinned.slice(this._maxItems);
      for (const entry of toRemove) {
        if (entry.imagePath) {
          try {
            const file = Gio2.File.new_for_path(entry.imagePath);
            if (file.query_exists(null)) {
              file.delete(null);
            }
          } catch (e) {
            debug(`Error deleting evicted image: ${e}`);
          }
        }
      }
      const kept = unpinned.slice(0, this._maxItems);
      this._entries = [...pinned, ...kept];
    }
  }
};

// src/clipboardDialog.ts
import Clutter from "gi://Clutter";
import Gio3 from "gi://Gio";
import GLib4 from "gi://GLib";
import St2 from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
var DIALOG_WIDTH = 420;
var DIALOG_HEIGHT = 520;
var ITEM_MAX_TEXT_LEN = 80;
var THUMBNAIL_SIZE = 64;
var IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tiff", ".tif"];
function parseFilePaths(fileContent) {
  return fileContent.split("\n").filter((l) => l.startsWith("file://")).map((l) => decodeURIComponent(l.replace("file://", "")));
}
function getFileName(filePath) {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}
function isImageFile(filePath) {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
var ClipboardDialog = class {
  _container;
  _searchEntry;
  _scrollView;
  _listBox;
  _emptyLabel;
  _clipboardManager;
  _historyManager;
  _visible = false;
  _selectedIndex = -1;
  _keyPressId = null;
  _focusGrabId = null;
  _clickOutsideId = null;
  constructor(clipboardManager, historyManager) {
    this._clipboardManager = clipboardManager;
    this._historyManager = historyManager;
    this._container = new St2.BoxLayout({
      style_class: "winclip-dialog",
      vertical: true,
      reactive: true,
      can_focus: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER
    });
    this._container.set_width(DIALOG_WIDTH);
    this._container.set_height(DIALOG_HEIGHT);
    const header = new St2.BoxLayout({
      style_class: "winclip-header",
      x_expand: true
    });
    const titleLabel = new St2.Label({
      text: "\u{1F4CB} Clipboard History",
      style_class: "winclip-title",
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true
    });
    header.add_child(titleLabel);
    const clearButton = new St2.Button({
      style_class: "winclip-clear-button",
      child: new St2.Icon({
        icon_name: "user-trash-symbolic",
        icon_size: 16
      }),
      y_align: Clutter.ActorAlign.CENTER
    });
    clearButton.connect("clicked", () => this._onClearAll());
    header.add_child(clearButton);
    const closeButton = new St2.Button({
      style_class: "winclip-close-button",
      child: new St2.Icon({
        icon_name: "window-close-symbolic",
        icon_size: 16
      }),
      y_align: Clutter.ActorAlign.CENTER
    });
    closeButton.connect("clicked", () => this.hide());
    header.add_child(closeButton);
    this._container.add_child(header);
    this._searchEntry = new St2.Entry({
      style_class: "winclip-search",
      hint_text: "Search clipboard\u2026",
      can_focus: true,
      x_expand: true,
      primary_icon: new St2.Icon({ icon_name: "edit-find-symbolic" })
    });
    this._searchEntry.get_clutter_text().connect("text-changed", () => {
      this._refreshList();
    });
    this._container.add_child(this._searchEntry);
    this._scrollView = new St2.ScrollView({
      style_class: "winclip-scroll",
      x_expand: true,
      y_expand: true,
      overlay_scrollbars: true
    });
    this._listBox = new St2.BoxLayout({
      vertical: true,
      style_class: "winclip-list",
      x_expand: true
    });
    this._scrollView.set_child(this._listBox);
    this._container.add_child(this._scrollView);
    this._emptyLabel = new St2.Label({
      text: "No clipboard history yet.\nCopy something to get started!",
      style_class: "winclip-empty",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true
    });
    this._container.hide();
  }
  /**
   * Get the St widget to add to the shell chrome.
   */
  get actor() {
    return this._container;
  }
  /**
   * Toggle the dialog visibility.
   */
  toggle() {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }
  /**
   * Show the dialog.
   */
  show() {
    if (this._visible) return;
    this._visible = true;
    this._positionDialog();
    this._refreshList();
    this._container.show();
    this._searchEntry.set_text("");
    this._selectedIndex = -1;
    GLib4.timeout_add(GLib4.PRIORITY_DEFAULT, 50, () => {
      global.stage.set_key_focus(this._searchEntry);
      return GLib4.SOURCE_REMOVE;
    });
    this._keyPressId = global.stage.connect("key-press-event", (_actor, event) => {
      if (!this._visible) return Clutter.EVENT_PROPAGATE;
      return this._onKeyPress(event);
    });
    this._clickOutsideId = global.stage.connect("captured-event", (_actor, event) => {
      if (!this._visible) return Clutter.EVENT_PROPAGATE;
      if (event.type() !== Clutter.EventType.BUTTON_PRESS && event.type() !== Clutter.EventType.TOUCH_BEGIN)
        return Clutter.EVENT_PROPAGATE;
      const [stageX, stageY] = event.get_coords();
      const [ok, localX, localY] = this._container.transform_stage_point(stageX, stageY);
      if (ok) {
        const alloc = this._container.get_allocation_box();
        const width = alloc.x2 - alloc.x1;
        const height = alloc.y2 - alloc.y1;
        if (localX < 0 || localX > width || localY < 0 || localY > height) {
          this.hide();
          return Clutter.EVENT_STOP;
        }
      }
      return Clutter.EVENT_PROPAGATE;
    });
    debug("Dialog shown");
  }
  /**
   * Hide the dialog.
   */
  hide() {
    if (!this._visible) return;
    this._visible = false;
    this._container.hide();
    if (this._keyPressId !== null) {
      global.stage.disconnect(this._keyPressId);
      this._keyPressId = null;
    }
    if (this._clickOutsideId !== null) {
      global.stage.disconnect(this._clickOutsideId);
      this._clickOutsideId = null;
    }
    global.stage.set_key_focus(null);
    debug("Dialog hidden");
  }
  /**
   * Check if the dialog is currently visible.
   */
  isVisible() {
    return this._visible;
  }
  /**
   * Refresh the item list from history.
   */
  refreshList() {
    this._refreshList();
  }
  /**
   * Destroy the dialog and all its children.
   */
  destroy() {
    this.hide();
    this._container.destroy_all_children();
    this._container.destroy();
  }
  // ------- Private -------
  _positionDialog() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (monitor) {
      this._container.set_position(
        monitor.x + Math.floor((monitor.width - DIALOG_WIDTH) / 2),
        monitor.y + Math.floor((monitor.height - DIALOG_HEIGHT) / 2)
      );
    }
  }
  _refreshList() {
    this._listBox.destroy_all_children();
    const query = this._searchEntry.get_text();
    const entries = this._historyManager.getEntries(query);
    if (entries.length === 0) {
      this._listBox.add_child(this._createEmptyState());
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const item = this._createItemWidget(entry, i);
      this._listBox.add_child(item);
    }
  }
  _createEmptyState() {
    const box = new St2.BoxLayout({
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
      style: "padding: 40px 0;"
    });
    box.add_child(new St2.Icon({
      icon_name: "edit-paste-symbolic",
      icon_size: 48,
      style: "color: rgba(255,255,255,0.3); margin-bottom: 12px;",
      x_align: Clutter.ActorAlign.CENTER
    }));
    box.add_child(new St2.Label({
      text: "Clipboard is empty",
      style: "color: rgba(255,255,255,0.5); font-size: 14px;",
      x_align: Clutter.ActorAlign.CENTER
    }));
    return box;
  }
  _createItemWidget(entry, index) {
    const row = new St2.BoxLayout({
      style_class: entry.pinned ? "winclip-item winclip-item-pinned" : "winclip-item",
      reactive: true,
      can_focus: true,
      track_hover: true,
      x_expand: true
    });
    const contentBox = new St2.BoxLayout({
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: "spacing: 10px;"
    });
    if (entry.type === ContentType.TEXT) {
      const icon = new St2.Icon({
        icon_name: "text-x-generic-symbolic",
        icon_size: 18,
        style_class: "winclip-item-icon",
        y_align: Clutter.ActorAlign.CENTER
      });
      contentBox.add_child(icon);
      const label = new St2.Label({
        text: truncateText(entry.text || "", ITEM_MAX_TEXT_LEN),
        style_class: "winclip-item-text",
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true
      });
      label.get_clutter_text().set_ellipsize(3);
      contentBox.add_child(label);
    } else if (entry.type === ContentType.IMAGE) {
      if (entry.imagePath) {
        try {
          const gicon = Gio3.icon_new_for_string(entry.imagePath);
          const thumb = new St2.Icon({
            gicon,
            icon_size: THUMBNAIL_SIZE,
            style_class: "winclip-item-image",
            y_align: Clutter.ActorAlign.CENTER
          });
          contentBox.add_child(thumb);
        } catch (e) {
          const fallback = new St2.Icon({
            icon_name: "image-x-generic-symbolic",
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER
          });
          contentBox.add_child(fallback);
        }
      }
      const label = new St2.Label({
        text: "\u{1F5BC} Image",
        style_class: "winclip-item-text",
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true
      });
      contentBox.add_child(label);
    } else if (entry.type === ContentType.FILE && entry.text) {
      const filePaths = parseFilePaths(entry.text);
      const fileNames = filePaths.map((p) => getFileName(p));
      const firstFile = filePaths.length > 0 ? filePaths[0] : null;
      const isImage = firstFile !== null && isImageFile(firstFile);
      if (isImage && firstFile) {
        try {
          const gicon = Gio3.icon_new_for_string(firstFile);
          const thumb = new St2.Icon({
            gicon,
            icon_size: THUMBNAIL_SIZE,
            style_class: "winclip-item-image",
            y_align: Clutter.ActorAlign.CENTER
          });
          contentBox.add_child(thumb);
        } catch (e) {
          const fallback = new St2.Icon({
            icon_name: "image-x-generic-symbolic",
            icon_size: 18,
            style_class: "winclip-item-icon",
            y_align: Clutter.ActorAlign.CENTER
          });
          contentBox.add_child(fallback);
        }
      } else {
        const icon = new St2.Icon({
          icon_name: "folder-documents-symbolic",
          icon_size: 18,
          style_class: "winclip-item-icon",
          y_align: Clutter.ActorAlign.CENTER
        });
        contentBox.add_child(icon);
      }
      const displayText = fileNames.length > 0 ? isImage ? `\u{1F5BC} ${fileNames.join(", ")}` : `\u{1F4C1} ${fileNames.join(", ")}` : "\u{1F4C1} Files";
      const label = new St2.Label({
        text: truncateText(displayText, ITEM_MAX_TEXT_LEN),
        style_class: "winclip-item-text",
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true
      });
      label.get_clutter_text().set_ellipsize(3);
      contentBox.add_child(label);
    }
    row.add_child(contentBox);
    const actionsBox = new St2.BoxLayout({
      y_align: Clutter.ActorAlign.CENTER,
      style: "spacing: 4px;"
    });
    const pinButton = new St2.Button({
      style_class: "winclip-action-button",
      child: new St2.Icon({
        icon_name: entry.pinned ? "starred-symbolic" : "non-starred-symbolic",
        icon_size: 14
      }),
      y_align: Clutter.ActorAlign.CENTER
    });
    pinButton.connect("clicked", () => {
      this._historyManager.togglePin(entry.id);
      this._refreshList();
    });
    actionsBox.add_child(pinButton);
    const deleteButton = new St2.Button({
      style_class: "winclip-action-button",
      child: new St2.Icon({
        icon_name: "edit-delete-symbolic",
        icon_size: 14
      }),
      y_align: Clutter.ActorAlign.CENTER
    });
    deleteButton.connect("clicked", () => {
      this._historyManager.removeEntry(entry.id);
      this._refreshList();
    });
    actionsBox.add_child(deleteButton);
    row.add_child(actionsBox);
    row.connect("button-press-event", () => {
      this._selectAndPaste(entry);
      return Clutter.EVENT_STOP;
    });
    return row;
  }
  _selectAndPaste(entry) {
    if (entry.type === ContentType.TEXT && entry.text) {
      this._clipboardManager.setTextContent(entry.text);
    } else if (entry.type === ContentType.IMAGE) {
      const imageBytes = this._historyManager.getImageBytes(entry);
      if (imageBytes) {
        this._clipboardManager.setImageContent(imageBytes);
      }
    } else if (entry.type === ContentType.FILE && entry.text) {
      const filePaths = parseFilePaths(entry.text);
      const firstFile = filePaths.length > 0 ? filePaths[0] : null;
      if (firstFile && isImageFile(firstFile)) {
        try {
          const file = Gio3.File.new_for_path(firstFile);
          if (file.query_exists(null)) {
            const [ok, contents] = file.load_contents(null);
            if (ok && contents) {
              this._clipboardManager.setImageContent(contents);
            }
          }
        } catch (e) {
          debug(`Error loading image file for paste: ${e}`);
          this._clipboardManager.setFileContent(entry.text);
        }
      } else {
        this._clipboardManager.setFileContent(entry.text);
      }
    }
    this.hide();
    GLib4.timeout_add(GLib4.PRIORITY_DEFAULT, 150, () => {
      try {
        const proc = Gio3.Subprocess.new(
          ["xdotool", "key", "ctrl+v"],
          Gio3.SubprocessFlags.NONE
        );
        proc.wait_async(null, null);
      } catch (e) {
        debug(`Error running xdotool: ${e}`);
      }
      return GLib4.SOURCE_REMOVE;
    });
  }
  _onClearAll() {
    const entries = this._historyManager.getEntries();
    for (const entry of entries) {
      if (!entry.pinned) {
        this._historyManager.removeEntry(entry.id);
      }
    }
    this._refreshList();
  }
  _onKeyPress(event) {
    const symbol = event.get_key_symbol();
    if (symbol === Clutter.KEY_Escape) {
      this.hide();
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_BackSpace) {
      const focusedActor = global.stage.get_key_focus();
      if (focusedActor && focusedActor !== this._searchEntry) {
        const query = this._searchEntry.get_text();
        const entries = this._historyManager.getEntries(query);
        const children = this._listBox.get_children();
        const focusIndex = children.indexOf(focusedActor);
        if (focusIndex >= 0 && focusIndex < entries.length) {
          this._historyManager.removeEntry(entries[focusIndex].id);
          this._refreshList();
          return Clutter.EVENT_STOP;
        }
      }
    }
    if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_Tab) {
      this._navigateList(1);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Up) {
      this._navigateList(-1);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
      const focusedActor = global.stage.get_key_focus();
      if (focusedActor && focusedActor !== this._searchEntry) {
        const query = this._searchEntry.get_text();
        const entries = this._historyManager.getEntries(query);
        const children = this._listBox.get_children();
        const focusIndex = children.indexOf(focusedActor);
        if (focusIndex >= 0 && focusIndex < entries.length) {
          this._selectAndPaste(entries[focusIndex]);
          return Clutter.EVENT_STOP;
        }
      }
    }
    return Clutter.EVENT_PROPAGATE;
  }
  _navigateList(direction) {
    const children = this._listBox.get_children();
    if (children.length === 0) return;
    const focusedActor = global.stage.get_key_focus();
    let currentIndex = -1;
    if (focusedActor) {
      currentIndex = children.indexOf(focusedActor);
    }
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= children.length) nextIndex = children.length - 1;
    const nextChild = children[nextIndex];
    if (nextChild) {
      global.stage.set_key_focus(nextChild);
      this._selectedIndex = nextIndex;
    }
  }
};

// src/extension.ts
var KEYBINDING_NAME = "global-shortcut";
var WinClipExtension = class extends Extension {
  _clipboardManager = null;
  _historyManager = null;
  _dialog = null;
  _settings = null;
  _settingsChangedId = null;
  enable() {
    debug("Enabling WinClip extension");
    this._settings = this.getSettings();
    const maxItems = this._settings.get_int("max-history-items");
    this._clipboardManager = new ClipboardManager();
    this._historyManager = new HistoryManager(maxItems);
    this._dialog = new ClipboardDialog(this._clipboardManager, this._historyManager);
    Main2.layoutManager.addTopChrome(this._dialog.actor, {
      affectsInputRegion: true,
      affectsStruts: false,
      trackFullscreen: false
    });
    Main2.wm.addKeybinding(
      KEYBINDING_NAME,
      this._settings,
      Meta2.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell2.ActionMode.NORMAL | Shell2.ActionMode.OVERVIEW,
      () => {
        this._dialog?.toggle();
      }
    );
    this._clipboardManager.onChanged((entry) => {
      this._historyManager?.addEntry(entry);
      if (this._dialog?.isVisible()) {
        this._dialog.refreshList();
      }
    });
    this._clipboardManager.startTracking();
    this._settingsChangedId = this._settings.connect("changed::max-history-items", () => {
      const newMax = this._settings.get_int("max-history-items");
      this._historyManager?.setMaxItems(newMax);
    });
    debug("WinClip extension enabled");
  }
  disable() {
    debug("Disabling WinClip extension");
    Main2.wm.removeKeybinding(KEYBINDING_NAME);
    if (this._settings && this._settingsChangedId !== null) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
    if (this._clipboardManager) {
      this._clipboardManager.destroy();
      this._clipboardManager = null;
    }
    if (this._dialog) {
      Main2.layoutManager.removeChrome(this._dialog.actor);
      this._dialog.destroy();
      this._dialog = null;
    }
    if (this._historyManager) {
      this._historyManager.destroy();
      this._historyManager = null;
    }
    this._settings = null;
    debug("WinClip extension disabled");
  }
};
export {
  WinClipExtension as default
};
