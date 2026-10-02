#include <cassert>
#include <iostream>
#include "util/hyprland_lua_dispatch.hpp"

int main() {
  using waybar::util::workspace_dispatch;
  using waybar::util::lua_quote;
  assert(waybar::util::workspace_id("3") == 3);
  assert(waybar::util::workspace_id("special") == -99);
  assert(!waybar::util::workspace_id("1*"));
  assert(!waybar::util::workspace_id("1^"));
  assert(!waybar::util::workspace_id("name:1*"));
  assert(workspace_dispatch(3, "3", false, false) == "dispatch hl.dsp.focus({ workspace = 3 })");
  // Display labels must never replace the underlying positive-ID click target.
  assert(workspace_dispatch(101, "1*", false, false) == "dispatch hl.dsp.focus({ workspace = 101 })");
  assert(workspace_dispatch(201, "1^", false, false) == "dispatch hl.dsp.focus({ workspace = 201 })");
  assert(workspace_dispatch(109, "9*", false, true) == "dispatch hl.dsp.focus({ workspace = 109, on_current_monitor = true })");
  assert(workspace_dispatch(-2, "1*", false, false) == "dispatch hl.dsp.focus({ workspace = \"name:1*\" })");
  assert(workspace_dispatch(0, "1^", false, false) == "dispatch hl.dsp.focus({ workspace = \"name:1^\" })");
  assert(workspace_dispatch(3, "3", false, true) == "dispatch hl.dsp.focus({ workspace = 3, on_current_monitor = true })");
  assert(workspace_dispatch(-2, "1^", false, true) == "dispatch hl.dsp.focus({ workspace = \"name:1^\", on_current_monitor = true })");
  assert(workspace_dispatch(-99, "special", true, false) == "dispatch hl.dsp.workspace.toggle_special(\"\")");
  assert(workspace_dispatch(-100, "scratch", true, false) == "dispatch hl.dsp.workspace.toggle_special(\"scratch\")");
  assert(lua_quote("a\"\\\n1") == "\"a\\\"\\\\\\0101\"");
  assert(lua_quote(std::string("\0", 1)) == "\"\\000\"");
  // Emit Lua to verify that hostile names survive parsing as data, not code.
  const std::string hostile = "name:quote\"\\\n1'); error('injected') --";
  std::cout << "local value = " << lua_quote(hostile) << "\n";
  std::cout << "assert(#value == " << hostile.size() << ")\n";
  for (size_t i = 0; i < hostile.size(); ++i) {
    std::cout << "assert(value:byte(" << i + 1 << ") == " << unsigned(static_cast<unsigned char>(hostile[i])) << ")\n";
  }
  std::cout << "print('Waybar Lua dispatch: numeric/named/persistent/special/move/escaping tests passed.')\n";
}
