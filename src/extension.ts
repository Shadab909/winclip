// WinClip Extension - Main entry point
// Extends the GNOME Shell Extension base class with enable/disable lifecycle.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardManager, type ClipboardEntry } from './clipboardManager.js';
import { HistoryManager } from './historyManager.js';
import { ClipboardDialog } from './clipboardDialog.js';
import { debug } from './utils.js';

const KEYBINDING_NAME = 'global-shortcut';

export default class WinClipExtension extends Extension {
  private _clipboardManager: ClipboardManager | null = null;
  private _historyManager: HistoryManager | null = null;
  private _dialog: ClipboardDialog | null = null;
  private _settings: Gio.Settings | null = null;
  private _settingsChangedId: number | null = null;

  enable(): void {
    debug('Enabling WinClip extension');

    // Get GSettings
    this._settings = this.getSettings();

    const maxItems = this._settings.get_int('max-history-items');

    // Initialize managers
    this._clipboardManager = new ClipboardManager();
    this._historyManager = new HistoryManager(maxItems);
    this._dialog = new ClipboardDialog(this._clipboardManager, this._historyManager);

    // Add the dialog to the shell chrome (always on top)
    Main.layoutManager.addTopChrome(this._dialog.actor, {
      affectsInputRegion: true,
      affectsStruts: false,
      trackFullscreen: false,
    });

    // Bind keyboard shortcut (Super+V)
    Main.wm.addKeybinding(
      KEYBINDING_NAME,
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => {
        this._dialog?.toggle();
      }
    );

    // Listen for clipboard changes
    this._clipboardManager.onChanged((entry: ClipboardEntry) => {
      this._historyManager?.addEntry(entry);
      // Refresh dialog if it's visible
      if (this._dialog?.isVisible()) {
        this._dialog.refreshList();
      }
    });

    // Start clipboard tracking
    this._clipboardManager.startTracking();

    // Watch for settings changes
    this._settingsChangedId = this._settings.connect('changed::max-history-items', () => {
      const newMax = this._settings!.get_int('max-history-items');
      this._historyManager?.setMaxItems(newMax);
    });

    debug('WinClip extension enabled');
  }

  disable(): void {
    debug('Disabling WinClip extension');

    // Remove keybinding
    Main.wm.removeKeybinding(KEYBINDING_NAME);

    // Disconnect settings
    if (this._settings && this._settingsChangedId !== null) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }

    // Stop clipboard tracking and destroy manager
    if (this._clipboardManager) {
      this._clipboardManager.destroy();
      this._clipboardManager = null;
    }

    // Destroy dialog and remove from chrome
    if (this._dialog) {
      Main.layoutManager.removeChrome(this._dialog.actor);
      this._dialog.destroy();
      this._dialog = null;
    }

    // Flush and destroy history manager
    if (this._historyManager) {
      this._historyManager.destroy();
      this._historyManager = null;
    }

    this._settings = null;

    debug('WinClip extension disabled');
  }
}
