{ buildGoModule }:
buildGoModule {
  pname = "mm-sidebar";
  version = "0-unstable-2026-09-21";
  src = ../../tmux_scripts/mm-sidebar;
  vendorHash = "sha256-VQmbmL/5QflANAyF01xKFrr8/qlHZmXvz5jwqFi0v80=";
  subPackages = [ "." ];
}
