{ config, inputs, lib, pkgs, ... }:
let
  system = pkgs.stdenv.hostPlatform.system;
  grimoire = pkgs.callPackage ../packages/grimoire.nix { };
  helium = pkgs.callPackage ../packages/helium.nix { };
  legcord = pkgs.callPackage ../packages/legcord.nix { };
  sidra = inputs.sidra.packages.${system}.sidra;
  # Deliberately narrow defaults. Do not claim every type advertised by a package
  # (a browser/image viewer can also advertise PDFs, directories, or text).
  prefer = desktop: types: lib.genAttrs types (_: [ desktop ]);
  preferred =
    prefer "librewolf.desktop" [
      "text/html" "application/xhtml+xml"
      "x-scheme-handler/http" "x-scheme-handler/https"
      "x-scheme-handler/about" "x-scheme-handler/unknown"
    ]
    // prefer "org.kde.dolphin.desktop" [ "inode/directory" ]
    // prefer "org.kde.gwenview.desktop" [
      "image/jpeg" "image/png" "image/webp" "image/gif" "image/bmp"
      "image/tiff" "image/avif" "image/heif" "image/jxl"
      "image/svg+xml" "image/svg+xml-compressed" "image/x-icon" "image/vnd.microsoft.icon"
    ]
    // prefer "okularApplication_pdf.desktop" [ "application/pdf" "application/x-gzpdf" "application/x-bzpdf" ]
    // prefer "okularApplication_epub.desktop" [ "application/epub+zip" ]
    // prefer "okularApplication_djvu.desktop" [ "image/vnd.djvu" ]
    // prefer "okularApplication_comicbook.desktop" [
      "application/x-cbz" "application/x-cbr" "application/x-cbt" "application/x-cb7"
    ]
    // prefer "vlc.desktop" [
      "video/mp4" "video/webm" "video/x-matroska" "video/quicktime"
      "video/x-msvideo" "video/mpeg" "video/mp2t" "video/ogg"
      "audio/mpeg" "audio/mp4" "audio/aac" "audio/flac" "audio/x-flac"
      "audio/ogg" "audio/opus" "audio/x-wav" "audio/wav" "audio/x-m4a"
      "audio/x-mpegurl" "audio/x-scpls" "application/ogg"
    ]
    // prefer "org.kde.ark.desktop" [
      "application/zip" "application/x-7z-compressed" "application/vnd.rar"
      "application/x-tar" "application/gzip" "application/x-bzip2"
      "application/x-xz" "application/zstd" "application/x-compressed-tar"
      "application/x-bzip-compressed-tar" "application/x-xz-compressed-tar"
    ]
    // prefer "dev.zed.Zed.desktop" [
      "text/plain" "text/markdown" "text/x-log" "application/json"
      "application/toml" "application/yaml" "text/yaml" "application/xml" "text/xml"
      "text/x-python" "text/x-shellscript" "application/x-shellscript"
      "text/javascript" "application/javascript" "text/css" "text/x-csrc"
      "text/x-chdr" "text/x-c++src" "text/x-rust" "text/x-nix"
    ];
in
{
  home.packages = with pkgs; [
    blender
    obsidian
    grimoire
    helium
    librewolf
    kdePackages.gwenview
    kdePackages.okular
    vlc
    sidra
    legcord
    kdePackages.dolphin
    kdePackages.ark
    # Plasma KCMs launched from Hyprland need QML modules that Plasma normally
    # injects into its own session environment.
    kdePackages.kdeclarative
    kdePackages.kitemmodels
    # KDE's display KCM talks to KWin; use the compositor-neutral Wayland UI
    # for live monitor layout changes under Hyprland.
    wdisplays
    piper
    zed-editor
  ];

  xdg.configFile."zed".source =
    config.lib.file.mkOutOfStoreSymlink
      "${config.home.homeDirectory}/.dotfiles/zed";

  xdg.mimeApps = {
    enable = true;
    defaultApplications = preferred;
    # Keep alternative handlers available in Open With, including for types
    # intentionally added to an editor's otherwise minimal desktop entry.
    associations.added = preferred;
  };
}
