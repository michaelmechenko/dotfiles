{
  description = "NixOS desktop and Linux user environment";

  inputs = {
    # Start from the PC's installed release, not an unrelated system upgrade.
    nixpkgs.url = "github:NixOS/nixpkgs/1e8bc658fc985ef27ccd66d107d767b32bb7ef98";
    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Newer user tools only. NixOS modules continue to use the installed pin.
    nixpkgs-tools.url = "github:NixOS/nixpkgs/7bcd8b4473002e4804c92bd7798a4f736e0eb09e";
    # Pi moves faster than the OS pin; isolate it to a package-only revision.
    nixpkgs-pi.url = "github:NixOS/nixpkgs/6774f7bc253789b113a4f39285dc0fa100abeacc";
    sidra.url = "github:wimpysworld/sidra";
  };

  outputs = inputs@{ nixpkgs, home-manager, ... }: {
    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };
      modules = [
        ./nix/hosts/nixos
        home-manager.nixosModules.home-manager
        {
          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            # Existing files are backed up rather than silently overwritten.
            backupFileExtension = "before-home-manager";
            extraSpecialArgs = { inherit inputs; };
            users.mishka = import ./nix/home;
          };
        }
      ];
    };
  };
}
