{ nwg-dock-hyprland, fetchFromGitHub }:
nwg-dock-hyprland.overrideAttrs (_: {
  version = "0.4.11";
  src = fetchFromGitHub {
    owner = "nwg-piotr";
    repo = "nwg-dock-hyprland";
    tag = "v0.4.11";
    hash = "sha256-bd/FLQJFn1NERjPvz/wCgjUC88gK+QumIk11vdmjPkY=";
  };
  vendorHash = "sha256-AJGyBCTWtgTpn+e4HLlX/8EgWITw25py4UJJJDLhoOM=";
})
