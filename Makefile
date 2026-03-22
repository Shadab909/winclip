UUID = winclip@Shadab909.github.io
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: build install clean uninstall

build:
	npm install
	node esbuild.js
	glib-compile-schemas schemas/

install: build
	@mkdir -p $(INSTALL_DIR)/schemas
	cp dist/extension.js $(INSTALL_DIR)/extension.js
	cp dist/prefs.js $(INSTALL_DIR)/prefs.js
	cp metadata.json $(INSTALL_DIR)/metadata.json
	cp stylesheet.css $(INSTALL_DIR)/stylesheet.css
	cp schemas/org.gnome.shell.extensions.winclip.gschema.xml $(INSTALL_DIR)/schemas/
	cp schemas/gschemas.compiled $(INSTALL_DIR)/schemas/
	@echo ""
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Restart GNOME Shell (Alt+F2 → r) or log out/in, then run:"
	@echo "  gnome-extensions enable $(UUID)"

clean:
	rm -rf dist/
	rm -rf node_modules/
	rm -f schemas/gschemas.compiled

uninstall:
	rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(UUID)"
