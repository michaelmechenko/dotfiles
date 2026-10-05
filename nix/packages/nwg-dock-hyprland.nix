{ nwg-dock-hyprland, fetchFromGitHub, lib }:
let
  inherit (import ../home/palette.nix { inherit lib; }) roles;
in
nwg-dock-hyprland.overrideAttrs (old: {
  # Keep the tiny patch inline so an unstaged checkout is buildable by flakes.
  patches = (old.patches or []) ++ [ (builtins.toFile "nwg-dock-indicators.patch"
    (builtins.replaceStrings [ "@TAB@" ] [ "\t" ] ''
      --- a/tools.go
      +++ b/tools.go
      @@ -87 +87 @@
      -@TAB@@TAB@if *position == "left" || *position == "top" {
      +@TAB@@TAB@if *position == "left" || *position == "top" || *position == "bottom" {
      @@ -160 +160 @@
      -@TAB@@TAB@@TAB@@TAB@if *position == "left" || *position == "top" {
      +@TAB@@TAB@@TAB@@TAB@if *position == "left" || *position == "top" || *position == "bottom" {
      @@ -248 +248 @@
      -@TAB@@TAB@if *position == "left" || *position == "top" {
      +@TAB@@TAB@if *position == "left" || *position == "top" || *position == "bottom" {
    '')) ];
  postPatch = (old.postPatch or "") + ''
    for asset in images/task-single.svg images/task-multiple.svg; do
      substituteInPlace "$asset" --replace-fail 'fill:#00ffff' 'fill:${roles.accent-secondary}'
    done
  '';
  version = "0.4.11";
  src = fetchFromGitHub {
    owner = "nwg-piotr";
    repo = "nwg-dock-hyprland";
    tag = "v0.4.11";
    hash = "sha256-bd/FLQJFn1NERjPvz/wCgjUC88gK+QumIk11vdmjPkY=";
  };
  vendorHash = "sha256-AJGyBCTWtgTpn+e4HLlX/8EgWITw25py4UJJJDLhoOM=";
})
