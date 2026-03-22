// Shared utilities for WinClip extension

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Get the data directory for WinClip (~/.local/share/winclip/)
 */
export function getDataDir(): string {
  return GLib.build_filenamev([GLib.get_user_data_dir(), 'winclip']);
}

/**
 * Get the images directory for WinClip (~/.local/share/winclip/images/)
 */
export function getImagesDir(): string {
  return GLib.build_filenamev([getDataDir(), 'images']);
}

/**
 * Get the history file path (~/.local/share/winclip/history.json)
 */
export function getHistoryFilePath(): string {
  return GLib.build_filenamev([getDataDir(), 'history.json']);
}

/**
 * Ensure a directory exists, creating it if necessary.
 */
export function ensureDirectory(path: string): void {
  const dir = Gio.File.new_for_path(path);
  if (!dir.query_exists(null)) {
    dir.make_directory_with_parents(null);
  }
}

/**
 * Generate a unique ID for a history entry.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Truncate text to a maximum length, appending ellipsis if truncated.
 */
export function truncateText(text: string, maxLen: number): string {
  const singleLine = text.replace(/\n/g, ' ').trim();
  if (singleLine.length <= maxLen) {
    return singleLine;
  }
  return singleLine.substring(0, maxLen) + '…';
}

/**
 * Log a debug message prefixed with WinClip.
 */
export function debug(msg: string): void {
  console.log(`[WinClip] ${msg}`);
}
