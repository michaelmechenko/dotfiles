{ legcord, python3, lib, gtk3, gdk-pixbuf, pango, at-spi2-core,
  gobject-introspection, harfbuzz, glib, hicolor-icon-theme, xvfb-run }:
let
  python = python3.withPackages (p: [ p.pillow p.pygobject3 ]);
  typePaths = lib.makeSearchPath "lib/girepository-1.0" (map lib.getLib [
    gtk3 gdk-pixbuf pango at-spi2-core gobject-introspection harfbuzz glib
  ]);
in
# Keep the upstream package/version; replace only the desktop and fixed tray icons.
legcord.overrideAttrs (old: {
  nativeBuildInputs = (old.nativeBuildInputs or []) ++ [ python xvfb-run ];
  postPatch = (old.postPatch or "") + ''
    install -m644 ${../assets/discordlogo.png} build/icon.png
    install -m644 ${../assets/discordlogo.png} assets/desktop.png
    install -m644 ${../assets/discordlogo.png} assets/dsc-tray.png
  '';
  postInstall = (old.postInstall or "") + ''
    # GTK scales theme images using their directory's declared size. Never put
    # the full-resolution source in a 256x256 directory (menus become enormous).
    ${python}/bin/python3 - "$out" ${../assets/discordlogo.png} <<'PY'
    from pathlib import Path
    import sys
    from PIL import Image
    source = Image.open(sys.argv[2]).convert("RGBA")
    for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
        path = Path(sys.argv[1]) / f"share/icons/hicolor/{size}x{size}/apps/legcord.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        source.resize((size, size), Image.Resampling.LANCZOS).save(path)
    PY
    GI_TYPELIB_PATH=${lib.escapeShellArg typePaths} GDK_BACKEND=x11 \
      ${xvfb-run}/bin/xvfb-run -a ${python}/bin/python3 ${./legcord-icon-test.py} \
      "$out" ${../assets/discordlogo.png} ${hicolor-icon-theme}/share/icons
  '';
})
