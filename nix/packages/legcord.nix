{ legcord }:
# Keep the upstream package/version; replace only the desktop and fixed tray icons.
legcord.overrideAttrs (old: {
  postPatch = (old.postPatch or "") + ''
    install -m644 ${../assets/discordlogo.png} build/icon.png
    install -m644 ${../assets/discordlogo.png} assets/desktop.png
    install -m644 ${../assets/discordlogo.png} assets/dsc-tray.png
  '';
})
