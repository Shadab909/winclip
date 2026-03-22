// History persistence manager for WinClip
// Stores clipboard history to disk so it survives GNOME Shell restarts.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ContentType, type ClipboardEntry, type ContentTypeValue } from './clipboardManager.js';
import { getDataDir, getImagesDir, getHistoryFilePath, ensureDirectory, generateId, debug } from './utils.js';

export interface HistoryEntry {
  id: string;
  type: ContentTypeValue;
  text?: string;
  imagePath?: string;
  pinned: boolean;
  timestamp: number;
}

export class HistoryManager {
  private _entries: HistoryEntry[] = [];
  private _maxItems: number;
  private _saveTimeoutId: number | null = null;

  constructor(maxItems: number) {
    this._maxItems = maxItems;
    ensureDirectory(getDataDir());
    ensureDirectory(getImagesDir());
    this._load();
  }

  /**
   * Set the maximum number of history items (pinned items are exempt from eviction).
   */
  setMaxItems(maxItems: number): void {
    this._maxItems = maxItems;
    this._evict();
    this._scheduleSave();
  }

  /**
   * Add a new clipboard entry to history.
   * Returns the created HistoryEntry.
   */
  addEntry(clipEntry: ClipboardEntry): HistoryEntry {
    const entry: HistoryEntry = {
      id: generateId(),
      type: clipEntry.type,
      pinned: false,
      timestamp: Date.now(),
    };

    if (clipEntry.type === ContentType.TEXT && clipEntry.text) {
      // Deduplicate: remove existing identical text entries (move to top)
      const existingIndex = this._entries.findIndex(
        e => e.type === ContentType.TEXT && e.text === clipEntry.text
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
      const imagePath = GLib.build_filenamev([getImagesDir(), `${entry.id}.png`]);
      try {
        const file = Gio.File.new_for_path(imagePath);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        stream.write_bytes(new GLib.Bytes(clipEntry.imageBytes), null);
        stream.close(null);
        entry.imagePath = imagePath;
      } catch (e) {
        debug(`Error saving image: ${e}`);
        return entry;
      }
    } else if (clipEntry.type === ContentType.FILE && clipEntry.fileContent) {
      // Deduplicate: remove existing identical file entries (move to top)
      const existingIndex = this._entries.findIndex(
        e => e.type === ContentType.FILE && e.text === clipEntry.fileContent
      );
      if (existingIndex >= 0) {
        const existing = this._entries[existingIndex];
        this._entries.splice(existingIndex, 1);
        existing.timestamp = Date.now();
        this._entries.unshift(existing);
        this._scheduleSave();
        return existing;
      }

      // Store raw gnome-copied-files content in text field
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
  removeEntry(id: string): void {
    const index = this._entries.findIndex(e => e.id === id);
    if (index >= 0) {
      const entry = this._entries[index];
      // Delete image file if applicable
      if (entry.imagePath) {
        try {
          const file = Gio.File.new_for_path(entry.imagePath);
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
  togglePin(id: string): boolean {
    const entry = this._entries.find(e => e.id === id);
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
  getEntries(searchQuery?: string): HistoryEntry[] {
    let entries = [...this._entries];

    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      entries = entries.filter(e => {
        if ((e.type === ContentType.TEXT || e.type === ContentType.FILE) && e.text) {
          return e.text.toLowerCase().includes(query);
        }
        // Images can't be searched by text
        return false;
      });
    }

    // Sort: pinned first, then by timestamp descending
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
  getEntry(id: string): HistoryEntry | undefined {
    return this._entries.find(e => e.id === id);
  }

  /**
   * Read image bytes for a history entry.
   */
  getImageBytes(entry: HistoryEntry): Uint8Array | null {
    if (!entry.imagePath) return null;
    try {
      const file = Gio.File.new_for_path(entry.imagePath);
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
  destroy(): void {
    if (this._saveTimeoutId !== null) {
      GLib.Source.remove(this._saveTimeoutId);
      this._saveTimeoutId = null;
    }
    this._save();
  }

  // ------- Private -------

  private _load(): void {
    try {
      const historyPath = getHistoryFilePath();
      const file = Gio.File.new_for_path(historyPath);
      if (!file.query_exists(null)) {
        this._entries = [];
        return;
      }

      const [ok, contents] = file.load_contents(null);
      if (ok && contents) {
        const text = new TextDecoder().decode(contents);
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          this._entries = parsed as HistoryEntry[];
          // Validate image paths still exist
          this._entries = this._entries.filter(e => {
            if (e.type === ContentType.IMAGE && e.imagePath) {
              const imgFile = Gio.File.new_for_path(e.imagePath);
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

  private _save(): void {
    try {
      ensureDirectory(getDataDir());
      const historyPath = getHistoryFilePath();
      const file = Gio.File.new_for_path(historyPath);
      const data = JSON.stringify(this._entries, null, 2);
      const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
      stream.write_bytes(new GLib.Bytes(new TextEncoder().encode(data)), null);
      stream.close(null);
    } catch (e) {
      debug(`Error saving history: ${e}`);
    }
  }

  private _scheduleSave(): void {
    if (this._saveTimeoutId !== null) return;
    this._saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      this._save();
      this._saveTimeoutId = null;
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Evict oldest non-pinned items if over max.
   */
  private _evict(): void {
    const unpinned = this._entries.filter(e => !e.pinned);
    const pinned = this._entries.filter(e => e.pinned);

    if (unpinned.length > this._maxItems) {
      // Sort unpinned by timestamp descending, keep newest maxItems
      unpinned.sort((a, b) => b.timestamp - a.timestamp);
      const toRemove = unpinned.slice(this._maxItems);
      for (const entry of toRemove) {
        if (entry.imagePath) {
          try {
            const file = Gio.File.new_for_path(entry.imagePath);
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
}
