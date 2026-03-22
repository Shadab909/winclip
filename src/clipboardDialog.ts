// Floating clipboard history dialog for WinClip
// Displays clipboard history as a centered, always-on-top dialog triggered by Super+V.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ContentType, type ClipboardManager } from './clipboardManager.js';
import { type HistoryEntry, type HistoryManager } from './historyManager.js';
import { truncateText, debug } from './utils.js';

const DIALOG_WIDTH = 420;
const DIALOG_HEIGHT = 520;
const ITEM_MAX_TEXT_LEN = 80;
const THUMBNAIL_SIZE = 64;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.tif'];

/**
 * Parse file URIs from x-special/gnome-copied-files content.
 * Format: "copy\nfile:///path1\nfile:///path2"
 */
function parseFilePaths(fileContent: string): string[] {
  return fileContent
    .split('\n')
    .filter(l => l.startsWith('file://'))
    .map(l => decodeURIComponent(l.replace('file://', '')));
}

/**
 * Get just the filename from a full path.
 */
function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * Check if a file path is an image based on extension.
 */
function isImageFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * The main floating dialog that shows clipboard history.
 */
export class ClipboardDialog {
  private _container: St.BoxLayout;
  private _searchEntry: St.Entry;
  private _scrollView: St.ScrollView;
  private _listBox: St.BoxLayout;
  private _emptyLabel: St.Label;
  private _clipboardManager: ClipboardManager;
  private _historyManager: HistoryManager;
  private _visible: boolean = false;
  private _selectedIndex: number = -1;
  private _keyPressId: number | null = null;
  private _focusGrabId: number | null = null;
  private _clickOutsideId: number | null = null;

  constructor(clipboardManager: ClipboardManager, historyManager: HistoryManager) {
    this._clipboardManager = clipboardManager;
    this._historyManager = historyManager;

    // --- Main container ---
    this._container = new St.BoxLayout({
      style_class: 'winclip-dialog',
      vertical: true,
      reactive: true,
      can_focus: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._container.set_width(DIALOG_WIDTH);
    this._container.set_height(DIALOG_HEIGHT);

    // --- Header ---
    const header = new St.BoxLayout({
      style_class: 'winclip-header',
      x_expand: true,
    });

    const titleLabel = new St.Label({
      text: '📋 Clipboard History',
      style_class: 'winclip-title',
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    header.add_child(titleLabel);

    const clearButton = new St.Button({
      style_class: 'winclip-clear-button',
      child: new St.Icon({
        icon_name: 'user-trash-symbolic',
        icon_size: 16,
      }),
      y_align: Clutter.ActorAlign.CENTER,
    });
    clearButton.connect('clicked', () => this._onClearAll());
    header.add_child(clearButton);

    // Close (X) button
    const closeButton = new St.Button({
      style_class: 'winclip-close-button',
      child: new St.Icon({
        icon_name: 'window-close-symbolic',
        icon_size: 16,
      }),
      y_align: Clutter.ActorAlign.CENTER,
    });
    closeButton.connect('clicked', () => this.hide());
    header.add_child(closeButton);

    this._container.add_child(header);

    // --- Search entry ---
    this._searchEntry = new St.Entry({
      style_class: 'winclip-search',
      hint_text: 'Search clipboard…',
      can_focus: true,
      x_expand: true,
      primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic' }),
    });
    this._searchEntry.get_clutter_text().connect('text-changed', () => {
      this._refreshList();
    });
    this._container.add_child(this._searchEntry);

    // --- Scroll view with list ---
    this._scrollView = new St.ScrollView({
      style_class: 'winclip-scroll',
      x_expand: true,
      y_expand: true,
      overlay_scrollbars: true,
    });

    this._listBox = new St.BoxLayout({
      vertical: true,
      style_class: 'winclip-list',
      x_expand: true,
    });

    this._scrollView.set_child(this._listBox);
    this._container.add_child(this._scrollView);

    // --- Empty state ---
    this._emptyLabel = new St.Label({
      text: 'No clipboard history yet.\nCopy something to get started!',
      style_class: 'winclip-empty',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
    });

    // Initially hidden; we add to chrome but hide it
    this._container.hide();
  }

  /**
   * Get the St widget to add to the shell chrome.
   */
  get actor(): St.BoxLayout {
    return this._container;
  }

  /**
   * Toggle the dialog visibility.
   */
  toggle(): void {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Show the dialog.
   */
  show(): void {
    if (this._visible) return;
    this._visible = true;

    this._positionDialog();
    this._refreshList();
    this._container.show();
    this._searchEntry.set_text('');
    this._selectedIndex = -1;

    // Focus the search entry
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      global.stage.set_key_focus(this._searchEntry);
      return GLib.SOURCE_REMOVE;
    });

    // Handle keyboard events on global.stage (chrome actors don't bubble key events to the container reliably)
    this._keyPressId = global.stage.connect('key-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (!this._visible) return Clutter.EVENT_PROPAGATE;
      return this._onKeyPress(event);
    });

    // Handle clicks outside the dialog using captured-event (fires before child actors)
    this._clickOutsideId = global.stage.connect('captured-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
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

    debug('Dialog shown');
  }

  /**
   * Hide the dialog.
   */
  hide(): void {
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

    // Return focus to the previously focused window
    global.stage.set_key_focus(null);

    debug('Dialog hidden');
  }

  /**
   * Check if the dialog is currently visible.
   */
  isVisible(): boolean {
    return this._visible;
  }

  /**
   * Refresh the item list from history.
   */
  refreshList(): void {
    this._refreshList();
  }

  /**
   * Destroy the dialog and all its children.
   */
  destroy(): void {
    this.hide();
    this._container.destroy_all_children();
    this._container.destroy();
  }

  // ------- Private -------

  private _positionDialog(): void {
    const monitor = Main.layoutManager.primaryMonitor;
    if (monitor) {
      this._container.set_position(
        monitor.x + Math.floor((monitor.width - DIALOG_WIDTH) / 2),
        monitor.y + Math.floor((monitor.height - DIALOG_HEIGHT) / 2)
      );
    }
  }

  private _refreshList(): void {
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

  private _createEmptyState(): St.BoxLayout {
    const box = new St.BoxLayout({
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
      style: 'padding: 40px 0;',
    });

    box.add_child(new St.Icon({
      icon_name: 'edit-paste-symbolic',
      icon_size: 48,
      style: 'color: rgba(255,255,255,0.3); margin-bottom: 12px;',
      x_align: Clutter.ActorAlign.CENTER,
    }));

    box.add_child(new St.Label({
      text: 'Clipboard is empty',
      style: 'color: rgba(255,255,255,0.5); font-size: 14px;',
      x_align: Clutter.ActorAlign.CENTER,
    }));

    return box;
  }

  private _createItemWidget(entry: HistoryEntry, index: number): St.BoxLayout {
    const row = new St.BoxLayout({
      style_class: entry.pinned ? 'winclip-item winclip-item-pinned' : 'winclip-item',
      reactive: true,
      can_focus: true,
      track_hover: true,
      x_expand: true,
    });

    // Content area (icon/thumb + text)
    const contentBox = new St.BoxLayout({
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: 'spacing: 10px;',
    });

    if (entry.type === ContentType.TEXT) {
      const icon = new St.Icon({
        icon_name: 'text-x-generic-symbolic',
        icon_size: 18,
        style_class: 'winclip-item-icon',
        y_align: Clutter.ActorAlign.CENTER,
      });
      contentBox.add_child(icon);

      const label = new St.Label({
        text: truncateText(entry.text || '', ITEM_MAX_TEXT_LEN),
        style_class: 'winclip-item-text',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      label.get_clutter_text().set_ellipsize(3); // PANGO_ELLIPSIZE_END
      contentBox.add_child(label);
    } else if (entry.type === ContentType.IMAGE) {
      // Image thumbnail
      if (entry.imagePath) {
        try {
          const gicon = Gio.icon_new_for_string(entry.imagePath);
          const thumb = new St.Icon({
            gicon: gicon,
            icon_size: THUMBNAIL_SIZE,
            style_class: 'winclip-item-image',
            y_align: Clutter.ActorAlign.CENTER,
          });
          contentBox.add_child(thumb);
        } catch (e) {
          const fallback = new St.Icon({
            icon_name: 'image-x-generic-symbolic',
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER,
          });
          contentBox.add_child(fallback);
        }
      }

      const label = new St.Label({
        text: '🖼 Image',
        style_class: 'winclip-item-text',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      contentBox.add_child(label);
    } else if (entry.type === ContentType.FILE && entry.text) {
      // File copy entry — parse file paths
      const filePaths = parseFilePaths(entry.text);
      const fileNames = filePaths.map(p => getFileName(p));
      const firstFile = filePaths.length > 0 ? filePaths[0] : null;
      const isImage = firstFile !== null && isImageFile(firstFile);

      // Show image thumbnail if the file is an image, otherwise show folder icon
      if (isImage && firstFile) {
        try {
          const gicon = Gio.icon_new_for_string(firstFile);
          const thumb = new St.Icon({
            gicon: gicon,
            icon_size: THUMBNAIL_SIZE,
            style_class: 'winclip-item-image',
            y_align: Clutter.ActorAlign.CENTER,
          });
          contentBox.add_child(thumb);
        } catch (e) {
          const fallback = new St.Icon({
            icon_name: 'image-x-generic-symbolic',
            icon_size: 18,
            style_class: 'winclip-item-icon',
            y_align: Clutter.ActorAlign.CENTER,
          });
          contentBox.add_child(fallback);
        }
      } else {
        const icon = new St.Icon({
          icon_name: 'folder-documents-symbolic',
          icon_size: 18,
          style_class: 'winclip-item-icon',
          y_align: Clutter.ActorAlign.CENTER,
        });
        contentBox.add_child(icon);
      }

      const displayText = fileNames.length > 0
        ? (isImage ? `🖼 ${fileNames.join(', ')}` : `📁 ${fileNames.join(', ')}`)
        : '📁 Files';

      const label = new St.Label({
        text: truncateText(displayText, ITEM_MAX_TEXT_LEN),
        style_class: 'winclip-item-text',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      label.get_clutter_text().set_ellipsize(3);
      contentBox.add_child(label);
    }

    row.add_child(contentBox);

    // --- Action buttons ---
    const actionsBox = new St.BoxLayout({
      y_align: Clutter.ActorAlign.CENTER,
      style: 'spacing: 4px;',
    });

    // Pin button
    const pinButton = new St.Button({
      style_class: 'winclip-action-button',
      child: new St.Icon({
        icon_name: entry.pinned ? 'starred-symbolic' : 'non-starred-symbolic',
        icon_size: 14,
      }),
      y_align: Clutter.ActorAlign.CENTER,
    });
    pinButton.connect('clicked', () => {
      this._historyManager.togglePin(entry.id);
      this._refreshList();
    });
    actionsBox.add_child(pinButton);

    // Delete button
    const deleteButton = new St.Button({
      style_class: 'winclip-action-button',
      child: new St.Icon({
        icon_name: 'edit-delete-symbolic',
        icon_size: 14,
      }),
      y_align: Clutter.ActorAlign.CENTER,
    });
    deleteButton.connect('clicked', () => {
      this._historyManager.removeEntry(entry.id);
      this._refreshList();
    });
    actionsBox.add_child(deleteButton);

    row.add_child(actionsBox);

    // Click to paste
    row.connect('button-press-event', () => {
      this._selectAndPaste(entry);
      return Clutter.EVENT_STOP;
    });

    return row;
  }

  private _selectAndPaste(entry: HistoryEntry): void {
    // Write to clipboard
    if (entry.type === ContentType.TEXT && entry.text) {
      this._clipboardManager.setTextContent(entry.text);
    } else if (entry.type === ContentType.IMAGE) {
      const imageBytes = this._historyManager.getImageBytes(entry);
      if (imageBytes) {
        this._clipboardManager.setImageContent(imageBytes);
      }
    } else if (entry.type === ContentType.FILE && entry.text) {
      // For image files: load actual image bytes and paste as image/png
      // For other files: restore x-special/gnome-copied-files clipboard data
      const filePaths = parseFilePaths(entry.text);
      const firstFile = filePaths.length > 0 ? filePaths[0] : null;

      if (firstFile && isImageFile(firstFile)) {
        // Load image bytes from disk and put on clipboard as image/png
        try {
          const file = Gio.File.new_for_path(firstFile);
          if (file.query_exists(null)) {
            const [ok, contents] = file.load_contents(null);
            if (ok && contents) {
              this._clipboardManager.setImageContent(contents);
            }
          }
        } catch (e) {
          debug(`Error loading image file for paste: ${e}`);
          // Fallback to file clipboard content
          this._clipboardManager.setFileContent(entry.text);
        }
      } else {
        this._clipboardManager.setFileContent(entry.text);
      }
    }

    // Hide dialog first
    this.hide();

    // Small delay to let focus return, then paste with xdotool
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      try {
        const proc = Gio.Subprocess.new(
          ['xdotool', 'key', 'ctrl+v'],
          Gio.SubprocessFlags.NONE
        );
        proc.wait_async(null, null);
      } catch (e) {
        debug(`Error running xdotool: ${e}`);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  private _onClearAll(): void {
    const entries = this._historyManager.getEntries();
    for (const entry of entries) {
      if (!entry.pinned) {
        this._historyManager.removeEntry(entry.id);
      }
    }
    this._refreshList();
  }

  private _onKeyPress(event: Clutter.Event): boolean {
    const symbol = event.get_key_symbol();

    // Escape closes the dialog
    if (symbol === Clutter.KEY_Escape) {
      this.hide();
      return Clutter.EVENT_STOP;
    }

    // Delete key removes the focused item
    if (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_BackSpace) {
      // Only if search is empty and an item is focused
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

    // Arrow keys for navigation
    if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_Tab) {
      this._navigateList(1);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Up) {
      this._navigateList(-1);
      return Clutter.EVENT_STOP;
    }

    // Enter to paste the focused item
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

  private _navigateList(direction: number): void {
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
}
