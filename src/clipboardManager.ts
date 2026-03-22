// Clipboard monitoring service for WinClip
// Watches the system clipboard via Meta.Selection and emits 'changed' when new content is copied.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';

import { debug } from './utils.js';

export const ContentType = {
  TEXT: 0,
  IMAGE: 1,
  FILE: 2,
} as const;

export type ContentTypeValue = typeof ContentType[keyof typeof ContentType];

export interface ClipboardEntry {
  type: ContentTypeValue;
  text?: string;
  imageBytes?: Uint8Array;
  fileContent?: string;  // raw x-special/gnome-copied-files content
}

const TEXT_MIME_TYPES = ['text/plain', 'text/plain;charset=utf-8', 'UTF8_STRING'];
const IMAGE_MIME_TYPES = ['image/png'];
const FILE_MIME_TYPES = ['x-special/gnome-copied-files'];

function hasMimeType(clipboardMimeTypes: string[], targetMimeTypes: string[]): boolean {
  return clipboardMimeTypes.some(m => targetMimeTypes.includes(m));
}

function getMatchingMimeType(clipboardMimeTypes: string[], targetMimeTypes: string[]): string | undefined {
  return clipboardMimeTypes.find(m => targetMimeTypes.includes(m));
}

/**
 * ClipboardManager monitors the system clipboard for changes.
 * 
 * It connects to Meta.Selection's 'owner-changed' signal to detect when clipboard
 * content changes, then reads the content using St.Clipboard APIs.
 * 
 * Emits a custom 'changed' signal with the new ClipboardEntry.
 */
export class ClipboardManager {
  private _clipboard: St.Clipboard;
  private _selection: Meta.Selection;
  private _selectionChangedId: number | null = null;
  private _lastText: string | null = null;
  private _lastImageHash: number = 0;
  private _lastFileContent: string | null = null;
  private _isTracking: boolean = false;
  private _changeCallbacks: Array<(entry: ClipboardEntry) => void> = [];

  constructor() {
    this._clipboard = St.Clipboard.get_default();
    this._selection = Shell.Global.get().get_display().get_selection();
  }

  /**
   * Register a callback for clipboard changes.
   */
  onChanged(callback: (entry: ClipboardEntry) => void): void {
    this._changeCallbacks.push(callback);
  }

  /**
   * Start tracking clipboard changes.
   */
  startTracking(): void {
    if (this._isTracking) return;
    this._isTracking = true;

    this._selectionChangedId = this._selection.connect(
      'owner-changed',
      (_selection: Meta.Selection, selectionType: Meta.SelectionType, _source: Meta.SelectionSource) => {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
          // Small delay to let clipboard content settle
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._readClipboard();
            return GLib.SOURCE_REMOVE;
          });
        }
      }
    );

    debug('Clipboard tracking started');
  }

  /**
   * Stop tracking clipboard changes.
   */
  stopTracking(): void {
    if (this._selectionChangedId !== null) {
      this._selection.disconnect(this._selectionChangedId);
      this._selectionChangedId = null;
    }
    this._isTracking = false;
    this._lastText = null;
    this._lastImageHash = 0;
    this._lastFileContent = null;
    debug('Clipboard tracking stopped');
  }

  /**
   * Write text to the system clipboard.
   */
  setTextContent(text: string): void {
    this._lastText = text;
    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
  }

  /**
   * Write image bytes (PNG) to the system clipboard.
   */
  setImageContent(imageBytes: Uint8Array): void {
    this._lastImageHash = this._simpleHash(imageBytes);
    this._clipboard.set_content(
      St.ClipboardType.CLIPBOARD,
      IMAGE_MIME_TYPES[0],
      new GLib.Bytes(imageBytes)
    );
  }

  /**
   * Write file clipboard content (x-special/gnome-copied-files) back to clipboard.
   */
  setFileContent(fileContent: string): void {
    this._lastFileContent = fileContent;
    this._clipboard.set_content(
      St.ClipboardType.CLIPBOARD,
      FILE_MIME_TYPES[0],
      new GLib.Bytes(new TextEncoder().encode(fileContent))
    );
  }

  /**
   * Destroy the clipboard manager and release all resources.
   */
  destroy(): void {
    this.stopTracking();
    this._changeCallbacks = [];
  }

  // ------- Private -------

  private _readClipboard(): void {
    try {
      const mimeTypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);

      // Check for file copies (Nautilus/file manager) FIRST
      if (hasMimeType(mimeTypes, FILE_MIME_TYPES)) {
        const mime = getMatchingMimeType(mimeTypes, FILE_MIME_TYPES);
        if (!mime) return;

        this._clipboard.get_content(
          St.ClipboardType.CLIPBOARD,
          mime,
          (_clipboard: St.Clipboard, bytes: GLib.Bytes | Uint8Array) => {
            try {
              const data = bytes instanceof GLib.Bytes ? bytes.get_data() : bytes;
              if (data && data.length > 0) {
                const content = new TextDecoder().decode(data);
                if (content === this._lastFileContent) return;
                this._lastFileContent = content;
                this._lastText = null;
                this._lastImageHash = 0;

                const entry: ClipboardEntry = {
                  type: ContentType.FILE,
                  fileContent: content,
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
          (_clipboard: St.Clipboard, bytes: GLib.Bytes | Uint8Array) => {
            try {
              const data = bytes instanceof GLib.Bytes ? bytes.get_data() : bytes;
              if (data && data.length > 0) {
                const hash = this._simpleHash(data);
                if (hash === this._lastImageHash) return;
                this._lastImageHash = hash;
                this._lastText = null;
                this._lastFileContent = null;

                const entry: ClipboardEntry = {
                  type: ContentType.IMAGE,
                  imageBytes: data,
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
          (_clipboard: St.Clipboard, text: string | null) => {
            try {
              if (text && text.trim()) {
                if (text === this._lastText) return;
                this._lastText = text;
                this._lastImageHash = 0;
                this._lastFileContent = null;

                const entry: ClipboardEntry = {
                  type: ContentType.TEXT,
                  text: text,
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

  private _emitChanged(entry: ClipboardEntry): void {
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
  private _simpleHash(data: Uint8Array): number {
    let hash = 0;
    const step = Math.max(1, Math.floor(data.length / 1000));
    for (let i = 0; i < data.length; i += step) {
      hash = ((hash << 5) - hash + data[i]) | 0;
    }
    return hash;
  }
}
