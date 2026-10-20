# LibreWolf + Sidebery

`chrome/userChrome.css` is the canonical browser stylesheet. Keep this file in
Git, not the browser profile (history, cookies, extension storage, or `prefs.js`).
It always hides native horizontal and vertical tabs, including when Sidebery is
closed or disabled. The address bar and extension sidebar remain intact. On
macOS, the navigation toolbar's existing window controls replace those in the
hidden tab toolbar outside fullscreen.

The browser-provided sidebar header is also hidden, including its title, close
button, and sidebar switcher. This applies to other browser sidebars too, not
just Sidebery. Sidebery's own navigation, tabs, indentation, and resizing remain
unchanged. The browser sidebar has no outer left margin or bottom padding, and
its left/bottom corners are square so its surface meets the window edges; the
top-right corner stays rounded. Native macOS window rounding still clips the
outer window corners. Existing sidebar/content outlines are 2px in the non-Nova
revamped layout outside fullscreen; split-view focus outlines remain native.
Restart LibreWolf after changing these rules.

Based on [Sidebery's instructions](https://github.com/mbnuqw/sidebery#how-to-hide-native-tabs).
Browser chrome selectors are internal APIs and may need updating after upgrades.

## Install on macOS

1. Install and open Sidebery. In `about:config`, set
   `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
2. Open `about:support` and use **Profile Folder → Show in Finder** to identify
   the profile actually in use. Do not guess from a profile name or a separate
   `Default=1` entry in `profiles.ini`.
3. Link only the stylesheet, substituting your actual profile and checkout:

   ```sh
   repo="$HOME/.config"
   profile="$HOME/Library/Application Support/librewolf/Profiles/YOUR-PROFILE"
   (
     set -eu
     test -d "$profile"
     source="$(cd "$repo" && pwd -P)/librewolf/chrome/userChrome.css"
     test -f "$source"
     destination="$profile/chrome/userChrome.css"
     if [ -e "$destination" ] || [ -L "$destination" ]; then
       printf 'Already exists; inspect and merge before linking: %s\n' "$destination" >&2
       exit 1
     fi
     mkdir -p "$profile/chrome"
     ln -s "$source" "$destination"
   )
   ```

   Existing content is never overwritten. If you already have a stylesheet,
   review and merge its rules into the canonical file before replacing it with
   a link. Leave the rest of the profile and `chrome/` directory unmanaged.
4. Fully quit and reopen LibreWolf. Reloading a web page does not reload this CSS.

Edit the repository file for future changes, then restart LibreWolf. An absolute
symlink must be recreated if the checkout moves. No `user.js` or generated
`prefs.js` edits are required.

## Sidebery styles

[`sidebery.css`](sidebery.css) is the tracked source copy of the extension's
custom styles. Sidebery does **not** load it automatically from disk. Copy its
contents into **Sidebery Settings → Styles editor → Sidebar**, replacing the
previous custom CSS. Changes apply there without a browser restart. Keep future
edits in this file and manually paste them into Sidebery again; do not link it
as `userChrome.css` or edit extension storage.

The styles preserve Comic Mono at 12px (install that font locally), compact tabs,
26px pinned tabs, centered pinned rows, the custom tree guides and title padding,
6px corners, and Vague colors documented in `../COLORS.md`: dark canvas/chrome,
highlighted active tabs, neutral text, and lavender accents. These are fixed dark
colors even when the browser uses a light theme; `theme switch` does not regenerate
this manually maintained stylesheet.
The 4px inner left/right padding remains inside Sidebery, independent of the
browser's flush outer edges. Duplicate declarations were consolidated; the effective tab margin stays
2px. The pinned divider now has equal 12px side insets (previously 12px/10px).

After pasting, check the divider spacing, normal/selected/nested tabs, pinned
centering, title descenders, and narrow sidebar widths. The saved copy has not
been automatically applied or independently render-tested.

## Check after activation

- The browser's “Sidebery” title/header row is absent, with no empty space;
  Sidebery's own navigation and tab layout remain unchanged.
- The sidebar meets the window's left/bottom edges without browser gutters;
  its top-right corner remains rounded. Check the 2px outlines for clipping and
  confirm sidebar resizing works. Internal tab padding should remain unchanged.
- Native tabs stay absent with Sidebery open, closed, and another sidebar selected;
  also check with Sidebery disabled. Sidebery tab selection and resizing work.
- Test native horizontal and vertical modes, new windows, narrow windows, and
  fullscreen. The address bar must remain usable without an empty tab strip.
- On macOS, check close/minimize/zoom controls outside fullscreen and the normal
  fullscreen controls on hover. Source inspection alone is not a rendering test.

## Roll back

With `repo` and `profile` set as above, remove only the managed link:

```sh
source="$(cd "$repo" && pwd -P)/librewolf/chrome/userChrome.css"
destination="$profile/chrome/userChrome.css"
if [ -L "$destination" ] && [ "$(readlink "$destination")" = "$source" ]; then
  rm "$destination"
else
  printf 'Not the managed link; leaving it untouched: %s\n' "$destination" >&2
fi
```

Fully quit and reopen LibreWolf to restore native tabs. Alternatively, disable
`toolkit.legacyUserProfileCustomizations.stylesheets` in `about:config` and
restart; this disables **all** profile chrome styles, not just this file.

## Scope

This is the macOS installation workflow. NixOS/Home Manager deployment can reuse
the stylesheets but is not configured here. Sidebery settings beyond the saved
custom CSS, themes, default browser selection, and Helium/window-manager migration
are separate concerns.
