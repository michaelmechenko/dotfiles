{
  description = "NixOS desktop and Linux user environment";

  inputs = {
    # Start from the PC's installed release, not an unrelated system upgrade.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixpkgs-tools.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-pi.url = "github:NixOS/nixpkgs/nixos-unstable";
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
