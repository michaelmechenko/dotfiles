#!/usr/bin/env python3
"""Inspect built desktop inputs and query defaults in a disposable HOME."""
import configparser
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile

files, home, system, source = map(Path, sys.argv[1:])
config = files / '.config'
parser = configparser.ConfigParser(interpolation=None)
parser.read(config / 'mimeapps.list')
defaults = parser['Default Applications']
added = parser['Added Associations']
assert dict(defaults) == dict(added), 'defaults and added associations drifted'
assert not dict(parser['Removed Associations']), 'do not remove alternative handlers'
expected = {
    'text/html': 'librewolf.desktop', 'application/xhtml+xml': 'librewolf.desktop',
    'x-scheme-handler/http': 'librewolf.desktop', 'x-scheme-handler/https': 'librewolf.desktop',
    'image/jpeg': 'org.kde.gwenview.desktop', 'image/png': 'org.kde.gwenview.desktop',
    'image/webp': 'org.kde.gwenview.desktop', 'image/svg+xml': 'org.kde.gwenview.desktop',
    'application/pdf': 'okularApplication_pdf.desktop', 'application/epub+zip': 'okularApplication_epub.desktop',
    'image/vnd.djvu': 'okularApplication_djvu.desktop', 'video/mp4': 'vlc.desktop',
    'audio/mpeg': 'vlc.desktop', 'application/zip': 'org.kde.ark.desktop',
    'inode/directory': 'org.kde.dolphin.desktop', 'text/plain': 'dev.zed.Zed.desktop',
    'text/markdown': 'dev.zed.Zed.desktop', 'text/x-nix': 'dev.zed.Zed.desktop',
}
for mime, desktop in expected.items():
    assert defaults[mime].rstrip(';') == desktop, (mime, defaults.get(mime))
for mime, desktop in defaults.items():
    assert '*' not in mime and desktop.rstrip(';') != 'helium.desktop'
    entry_path = home / 'share/applications' / desktop.rstrip(';')
    assert entry_path.is_file(), entry_path
    entry = configparser.ConfigParser(interpolation=None)
    entry.read(entry_path)
    command = entry['Desktop Entry']['Exec'].split()[0]
    assert Path(command).is_absolute() or (home / 'bin' / command).is_file() or (system / 'sw/bin' / command).is_file(), command

with tempfile.TemporaryDirectory(prefix='nixos-mime-') as temporary:
    root = Path(temporary)
    (root / '.config').mkdir()
    (root / '.config/mimeapps.list').symlink_to(config / 'mimeapps.list')
    env = {'HOME': str(root), 'PATH': f'{home}/bin:{system}/sw/bin:/usr/bin:/bin',
           'XDG_CONFIG_HOME': str(root / '.config'), 'XDG_DATA_HOME': str(root / 'data'),
           'XDG_DATA_DIRS': f'{home}/share:{system}/sw/share', 'XDG_CURRENT_DESKTOP': 'generic'}
    for mime, desktop in defaults.items():
        result = subprocess.check_output(['xdg-mime', 'query', 'default', mime], env=env, text=True).strip()
        assert result == desktop.rstrip(';'), (mime, result)
    browser = subprocess.check_output(['xdg-settings', 'get', 'default-web-browser'], env=env, text=True).strip()
    assert browser == 'librewolf.desktop', browser

# Parse only simple widget blocks, not Hyprland's Lua or nested structures.
def blocks(path, kind):
    text = path.read_text()
    values = []
    for body in re.findall(r'(?m)^\s*' + re.escape(kind) + r'\s*\{([^{}]*)\}', text):
        values.append(dict(re.findall(r'(?m)^[ \t]*([\w-]+)[ \t]*=[ \t]*(.*?)[ \t]*$', body)))
    return values

paper = blocks(config / 'hypr/hyprpaper.conf', 'wallpaper')
lock = blocks(config / 'hypr/hyprlock.conf', 'background')
assert len(paper) == len(lock) == 1
assert paper[0]['monitor'] == '*' and paper[0]['fit_mode'] == 'cover'
assert lock[0]['monitor'] == '' and paper[0]['path'] == lock[0]['path']
asset = Path(paper[0]['path'])
assert str(asset).startswith('/nix/store/') and asset.is_file(), asset
fingerprint = 'c270b6d020b8d034104550aa980dc8ca97449126b824f8ca6676be26178c2e1e'
assert hashlib.sha256(asset.read_bytes()).hexdigest() == fingerprint
assert hashlib.sha256((source / 'nix/assets/wallpapers/monet1.jpg').read_bytes()).hexdigest() == fingerprint
assert '3648x2736' in subprocess.check_output(['file', '-b', str(asset)], text=True)
assert int(lock[0]['blur_passes']) == 3 and int(lock[0]['blur_size']) == 8
assert float(lock[0]['brightness']) == 0.75
assert re.search(r'(?m)^\s*splash\s*=\s*false\s*$', (config / 'hypr/hyprpaper.conf').read_text())
field = blocks(config / 'hypr/hyprlock.conf', 'input-field')
assert len(field) == 1 and field[0]['placeholder_text'] == 'Password'
assert field[0]['monitor'] == '' and field[0]['size'] == '320, 60'
lua = (config / 'hypr/hyprland.lua').read_text()
assert len(re.findall(r'uwsm app -s b -- /nix/store/[^"\n]+/bin/hyprpaper', lua)) == 1
assert 'pairs({ A = "librewolf", Z = "ghostty", S = "dolphin", X = "obsidian" })' in lua
assert 'hl.bind("SUPER + B", launch("helium"))' in lua
assert not (config / 'systemd/user/hyprpaper.service').exists()
assert 'listener' not in (config / 'hypr/hypridle.conf').read_text()

user_dirs = dict(re.findall(r'(?m)^(XDG_\w+_DIR)="([^"]+)"$', (config / 'user-dirs.dirs').read_text()))
assert user_dirs == {f'XDG_{key}_DIR': f'/home/mishka/{value}' for key, value in {
    'DESKTOP': 'Desktop', 'DOCUMENTS': 'Documents', 'DOWNLOAD': 'Downloads',
    'MUSIC': 'Music', 'PICTURES': 'Pictures', 'PROJECTS': 'Projects',
    'PUBLICSHARE': 'Public', 'TEMPLATES': 'Templates', 'VIDEOS': 'Videos',
}.items()}
print(f'Desktop defaults: {len(defaults)} installed handlers queried; Monet asset, backgrounds, UWSM hook, password UI and directories passed.')
