// WinClip Preferences Page
// Runs in a separate GTK4/Adw process, NOT inside gnome-shell.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WinClipPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    const settings = this.getSettings();

    // --- General page ---
    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'preferences-system-symbolic',
    });
    window.add(page);

    // --- History group ---
    const historyGroup = new Adw.PreferencesGroup({
      title: _('History'),
      description: _('Configure clipboard history behavior'),
    });
    page.add(historyGroup);

    // Max history items
    const maxItemsRow = new Adw.SpinRow({
      title: _('Maximum History Items'),
      subtitle: _('Maximum number of clipboard entries to keep (pinned items are exempt)'),
      adjustment: new Gtk.Adjustment({
        lower: 10,
        upper: 200,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int('max-history-items'),
      }),
    });

    settings.bind(
      'max-history-items',
      maxItemsRow,
      'value',
      Gio.SettingsBindFlags.DEFAULT
    );

    historyGroup.add(maxItemsRow);

    // --- Keyboard group ---
    const keyboardGroup = new Adw.PreferencesGroup({
      title: _('Keyboard'),
      description: _('Keyboard shortcut configuration'),
    });
    page.add(keyboardGroup);

    const shortcutRow = new Adw.ActionRow({
      title: _('Open Clipboard History'),
      subtitle: _('Super+V'),
    });
    shortcutRow.add_suffix(new Gtk.Image({
      icon_name: 'input-keyboard-symbolic',
      pixel_size: 18,
    }));
    keyboardGroup.add(shortcutRow);

    // --- About group ---
    const aboutGroup = new Adw.PreferencesGroup({
      title: _('About'),
    });
    page.add(aboutGroup);

    const aboutRow = new Adw.ActionRow({
      title: _('WinClip'),
      subtitle: _('Windows-style clipboard manager for GNOME Shell'),
    });
    aboutRow.add_suffix(new Gtk.Image({
      icon_name: 'edit-paste-symbolic',
      pixel_size: 24,
    }));
    aboutGroup.add(aboutRow);
  }
}
