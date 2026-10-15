#!/usr/bin/env python3
"""Real input/render regression against the generated config, never the live seat.

Uses a private Weston headless parent only for its GPU allocator; all test output,
virtual devices, IPC, HOME and screenshots belong to the nested Hyprland instance.
Dependencies WESTON and XKBCOMMON_LIB are supplied by nix/check.sh's pinned fixture.
The small wire client speaks the standard Wayland/xdg/virtual-input protocols.
"""
import array
import ctypes
import json
import os
from pathlib import Path
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time


def uints(*values):
    return struct.pack("I" * len(values), *values)


def string(value):
    data = value.encode() + b"\0"
    return uints(len(data)) + data + b"\0" * (-len(data) % 4)


def received_fds(ancillary):
    for level, kind, value in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            descriptors = array.array("i")
            descriptors.frombytes(value)
            yield from descriptors


def parent_bridge(root):
    """Adapt only the allocator parent, not Hyprland's input protocols.

    Aquamarine 0.11 unconditionally binds compositor/xdg v6; Weston 15 advertises
    v5. V6 adds only server events, not requests. Advertise v6 and lower the two
    parent bind requests to their advertised versions. No test traffic uses this
    bridge: clients connect directly to the nested compositor's separate socket.
    """
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(root / "bridge"))
        listener.listen(1)
        client, _ = listener.accept()
    with client, socket.socket(socket.AF_UNIX) as server:
        server.connect(str(root / "parent"))
        buffers = {client: b"", server: b""}
        descriptors = {client: [], server: []}
        registry, versions = None, {}
        while True:
            for source in select.select([client, server], [], [])[0]:
                data, ancillary, _, _ = source.recvmsg(262144, socket.CMSG_SPACE(4096))
                if not data:
                    return
                buffers[source] += data
                descriptors[source].extend(received_fds(ancillary))
                output = bytearray()
                while len(buffers[source]) >= 8:
                    obj, word = struct.unpack_from("II", buffers[source])
                    size, opcode = word >> 16, word & 65535
                    if len(buffers[source]) < size:
                        break
                    message = bytearray(buffers[source][:size])
                    buffers[source] = buffers[source][size:]
                    if source == client and obj == 1 and opcode == 1:
                        registry = struct.unpack_from("I", message, 8)[0]
                    if obj == registry and opcode == 0:
                        length = struct.unpack_from("I", message, 12)[0]
                        interface = bytes(message[16:16 + length - 1])
                        position = 16 + (length + 3) // 4 * 4
                        if interface in (b"wl_compositor", b"xdg_wm_base"):
                            if source == server:
                                versions[interface] = struct.unpack_from("I", message, position)[0]
                                struct.pack_into("I", message, position, max(6, versions[interface]))
                            else:
                                requested = struct.unpack_from("I", message, position)[0]
                                struct.pack_into("I", message, position, min(requested, versions[interface]))
                    output.extend(message)
                if output:
                    target = server if source == client else client
                    fds = descriptors[source]
                    target.sendmsg([output], [] if not fds else [
                        (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", fds))])
                    for descriptor in fds:
                        os.close(descriptor)
                    descriptors[source] = []


class WaylandFixture:
    def __init__(self, path):
        self.path = path
        self.controller = None
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.connect(str(path))
        self.next_id, self.buffered = 2, b""
        self.handlers, self.globals = {1: self.display_event}, {}
        self.buttons, self.keys = [], []
        self.dimensions = (600, 400)
        self.registry = self.new(self.registry_event)
        self.send(1, 1, uints(self.registry))
        self.sync()

    def new(self, handler=None):
        identifier = self.next_id
        self.next_id += 1
        if handler:
            self.handlers[identifier] = handler
        return identifier

    def send(self, obj, opcode, payload=b"", descriptor=None):
        message = uints(obj, ((8 + len(payload)) << 16) | opcode) + payload
        ancillary = [] if descriptor is None else [
            (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [descriptor]))]
        self.socket.sendmsg([message], ancillary)

    def pump(self, timeout=0.02):
        if not select.select([self.socket], [], [], timeout)[0]:
            return
        data, ancillary, _, _ = self.socket.recvmsg(262144, socket.CMSG_SPACE(4096))
        if not data:
            raise RuntimeError("Nested compositor disconnected")
        for descriptor in received_fds(ancillary):
            os.close(descriptor)
        self.buffered += data
        while len(self.buffered) >= 8:
            obj, word = struct.unpack_from("II", self.buffered)
            size, opcode = word >> 16, word & 65535
            if len(self.buffered) < size:
                break
            payload = self.buffered[8:size]
            self.buffered = self.buffered[size:]
            if obj in self.handlers:
                self.handlers[obj](opcode, payload)

    def sync(self):
        done = []
        callback = self.new(lambda *_: done.append(True))
        self.send(1, 0, uints(callback))
        deadline = time.monotonic() + 5
        while not done:
            assert time.monotonic() < deadline, "Wayland round-trip timed out"
            self.pump()

    def settle(self, seconds=0.06):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump(0.01)

    def display_event(self, opcode, payload):
        if opcode == 0:
            raise RuntimeError("Wayland protocol error: " + repr(payload))

    def registry_event(self, opcode, payload):
        if opcode == 0:
            name, length = struct.unpack_from("II", payload)
            interface = payload[8:8 + length - 1].decode()
            version = struct.unpack_from("I", payload, 8 + (length + 3) // 4 * 4)[0]
            self.globals[interface] = name, version

    def bind(self, interface, version=1, handler=None):
        name, maximum = self.globals[interface]
        identifier = self.new(handler)
        self.send(self.registry, 0, uints(name) + string(interface) + uints(min(version, maximum), identifier))
        return identifier

    def setup(self, with_input=True):
        if with_input:
            # Create devices before wl_seat.get_keyboard: a keyboard resource
            # requested from a keyboard-less seat would otherwise be inert.
            self.controller = WaylandFixture(self.path)
            self.controller.setup_input()
        compositor = self.bind("wl_compositor", 4)
        self.shm = self.bind("wl_shm")
        seat = self.bind("wl_seat", 5)
        pointer = self.new(lambda op, data: self.buttons.append(struct.unpack("IIII", data)) if op == 3 else None)
        keyboard = self.new(lambda op, data: self.keys.append(struct.unpack("IIII", data)) if op == 3 else None)
        self.send(seat, 0, uints(pointer))
        self.send(seat, 1, uints(keyboard))
        self.surface = self.new()
        self.send(compositor, 0, uints(self.surface))
        self.wm = self.bind("xdg_wm_base", handler=lambda op, data: self.send(self.wm, 3, data) if op == 0 else None)
        self.xdg = self.new(lambda op, data: self.configure(data) if op == 0 else None)
        self.send(self.wm, 2, uints(self.xdg, self.surface))
        self.top = self.new(self.toplevel_event)
        self.send(self.xdg, 1, uints(self.top))
        self.send(self.top, 3, string("winkeytoggle-fixture"))
        self.send(self.top, 2, string("winkeytoggle-fixture"))
        self.send(self.surface, 6)
        self.settle(0.3)

    def setup_input(self):
        seat = self.bind("wl_seat", 5)
        manager = self.bind("zwlr_virtual_pointer_manager_v1")
        self.pointer = self.new()
        self.send(manager, 0, uints(seat, self.pointer))
        manager = self.bind("zwp_virtual_keyboard_manager_v1")
        self.keyboard = self.new()
        self.send(manager, 0, uints(seat, self.keyboard))
        lib = ctypes.CDLL(os.environ["XKBCOMMON_LIB"])
        lib.xkb_context_new.restype = ctypes.c_void_p
        lib.xkb_keymap_new_from_names.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
        lib.xkb_keymap_new_from_names.restype = ctypes.c_void_p
        lib.xkb_keymap_get_as_string.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.xkb_keymap_get_as_string.restype = ctypes.c_void_p
        lib.xkb_keymap_unref.argtypes = [ctypes.c_void_p]
        lib.xkb_context_unref.argtypes = [ctypes.c_void_p]
        context = lib.xkb_context_new(0)
        keymap = lib.xkb_keymap_new_from_names(context, None, 0)
        assert context and keymap, "Could not create the test keymap"
        encoded = lib.xkb_keymap_get_as_string(keymap, 1)
        data = ctypes.string_at(encoded) + b"\0"
        libc = ctypes.CDLL(None)
        libc.free.argtypes = [ctypes.c_void_p]
        libc.free(encoded)
        lib.xkb_keymap_unref(keymap)
        lib.xkb_context_unref(context)
        descriptor = os.memfd_create("winkeytoggle-keymap")
        os.write(descriptor, data)
        self.send(self.keyboard, 0, uints(1, len(data)), descriptor)
        os.close(descriptor)
        self.sync()

    def toplevel_event(self, opcode, payload):
        if opcode == 0:
            width, height = struct.unpack_from("ii", payload)
            self.dimensions = width or self.dimensions[0], height or self.dimensions[1]

    def configure(self, serial):
        width, height = self.dimensions
        descriptor = os.memfd_create("winkeytoggle-surface")
        os.write(descriptor, b"\x30\x30\x30\xff" * (width * height))
        pool, buffer = self.new(), self.new()
        self.send(self.shm, 0, uints(pool, width * height * 4), descriptor)
        os.close(descriptor)
        self.send(pool, 0, uints(buffer, 0, width, height, width * 4, 1))
        self.send(pool, 1)
        self.send(self.xdg, 4, serial)
        self.send(self.surface, 1, uints(buffer, 0, 0))
        self.send(self.surface, 2, uints(0, 0, width, height))
        self.send(self.surface, 6)

    @staticmethod
    def now():
        return int(time.monotonic() * 1000) & 0xffffffff

    def modifiers(self, mask):
        assert self.controller is not None
        self.controller.send(self.controller.keyboard, 2, uints(mask, 0, 0, 0))
        self.settle()

    def key(self, code, pressed):
        assert self.controller is not None
        self.controller.send(self.controller.keyboard, 1, uints(self.now(), code, int(pressed)))
        self.settle()

    def chord(self, mask, code):
        self.modifiers(mask)
        self.key(code, True)
        self.key(code, False)
        self.modifiers(0)

    def move(self, x, y):
        assert self.controller is not None
        self.controller.send(self.controller.pointer, 1, uints(self.now(), int(x), int(y), 1280, 720))
        self.controller.send(self.controller.pointer, 4)
        self.settle()

    def button(self, button, pressed):
        assert self.controller is not None
        self.controller.send(self.controller.pointer, 2, uints(self.now(), button, int(pressed)))
        self.controller.send(self.controller.pointer, 4)
        self.settle()


def wait_for(predicate, description):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for " + description)


def run_tests(config, root):
    from PIL import Image

    processes, logs = [], []
    env = {key: value for key, value in os.environ.items() if key not in (
        "DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "HYPRLAND_INSTANCE_SIGNATURE", "DBUS_SESSION_BUS_ADDRESS")}
    env.update(XDG_RUNTIME_DIR=str(root), HOME=str(root / "home"), XDG_CONFIG_HOME=str(root / "home/config"),
               XDG_CACHE_HOME=str(root / "home/cache"), XDG_DATA_HOME=str(root / "home/data"),
               XDG_STATE_HOME=str(root / "home/state"), AQ_DRM_DEVICES="/dev/null", HYPRLAND_NO_SD_NOTIFY="1")
    Path(env["HOME"]).mkdir()
    # Only suppress deployment side effects, physical monitor declarations, and
    # external commands. Execute the actual generated bindings, hooks and colors.
    fixture_config = root / "hyprland.lua"
    fixture_config.write_text('''local real_on, real_monitor, real_exec = hl.on, hl.monitor, hl.exec_cmd
hl.on = function(name, callback) if name ~= "hyprland.start" then return real_on(name, callback) end end
hl.monitor = function(_) end
hl.exec_cmd = function(command)
  local file = assert(io.open(os.getenv("XDG_RUNTIME_DIR") .. "/commands", "a"))
  file:write(command .. "\\n"); file:close()
end
''' + config.read_text() + '''
hl.monitor = real_monitor
hl.monitor({output = "", mode = "1280x720@60", position = "auto", scale = 1})
hl.config({animations = {enabled = false}})
''')
    # Intercept dispatcher commands too, so media/Print tests cannot affect host
    # audio or start a real screenshot selector.
    fixture_config.write_text(fixture_config.read_text().replace(
        "local real_on, real_monitor, real_exec = hl.on, hl.monitor, hl.exec_cmd",
        "local real_on, real_monitor = hl.on, hl.monitor\n"
        "hl.dsp.exec_cmd = function(command) return function() hl.exec_cmd(command) end end"))

    def spawn(arguments, name, environment=env):
        log = open(root / (name + ".log"), "wb")
        logs.append(log)
        process = subprocess.Popen(arguments, env=environment, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        return process

    wire = None
    try:
        spawn([os.environ["WESTON"], "--backend=headless", "--renderer=gl", "--socket=parent",
               "--width=1280", "--height=720", "--idle-time=0", "--no-config"], "weston")
        wait_for(lambda: (root / "parent").exists(), "private Weston socket")
        spawn([sys.executable, __file__, "--bridge", str(root)], "bridge")
        wait_for(lambda: (root / "bridge").exists(), "allocator bridge")
        compositor = spawn(["Hyprland", "-c", str(fixture_config)], "hyprland", dict(env, WAYLAND_DISPLAY="bridge"))

        def instance_ready():
            if compositor.poll() is not None:
                raise AssertionError("Nested Hyprland exited; see " + str(root / "hyprland.log"))
            for directory in (root / "hypr").glob("*"):
                if (directory / ".socket.sock").exists():
                    return directory.name

        instance = wait_for(instance_ready, "nested Hyprland IPC")
        env["HYPRLAND_INSTANCE_SIGNATURE"] = instance

        def control(*arguments):
            return subprocess.check_output(["hyprctl", *arguments], env=env, text=True, timeout=5).strip()

        def dispatch(expression):
            assert control("dispatch", expression) == "ok", expression
            assert wire is not None
            wire.settle()

        assert control("output", "create", "headless", "TEST") == "ok"
        wait_for(lambda: json.loads(control("monitors", "-j")), "private headless output")
        assert not control("configerrors"), control("configerrors")
        wire = WaylandFixture(root / "wayland-1")
        wire.setup()

        address = next(value["address"] for value in json.loads(control("clients", "-j"))
                       if value["class"] == "winkeytoggle-fixture")

        def window():
            return next(value for value in json.loads(control("clients", "-j")) if value["address"] == address)

        def geometry():
            value = window()
            return value["at"], value["size"]

        def reset_geometry():
            dispatch("hl.dsp.window.float({action='on'})")
            dispatch("hl.dsp.window.resize({x=600,y=400,relative=false})")
            dispatch("hl.dsp.window.move({x=200,y=150,relative=false})")
            wire.move(400, 350)

        def mode():
            return control("submap")

        def toggle(expected):
            wire.chord(65, 41)  # Super+Shift+physical grave, evdev (not XKB) code.
            assert mode() == expected, (mode(), expected)

        def drag(button, released):
            reset_geometry()
            before = geometry()
            wire.buttons.clear()
            wire.modifiers(64)
            wire.button(button, True)
            wire.move(480, 390)
            wire.button(button, False)
            wire.modifiers(0)
            after = geometry()
            if released:
                assert before == after, f"Win+drag {button} moved/resized the window: {before} -> {after}"
                assert [(event[2], event[3]) for event in wire.buttons] == [(button, 1), (button, 0)], wire.buttons
            else:
                assert before != after, f"Normal Win+drag {button} failed to move/resize"
                assert not wire.buttons, "Desktop drag leaked buttons into the client"

        palette = json.loads((Path(__file__).resolve().parents[2] / "theme/palettes/vague.json").read_text())
        roles = palette["roles"] | palette.get("overrides", {}).get("roles", {})

        def role(name):
            value = roles[name]
            return role(value[1:]) if value.startswith("@") else value

        def screenshot(name):
            wire.settle(0.2)
            path = root / (name + ".png")
            subprocess.run(["grim", "-o", "TEST", str(path)], env=dict(env, WAYLAND_DISPLAY="wayland-1"), check=True, timeout=5)
            with Image.open(path) as source:
                return source.convert("RGB")

        def border(name, label):
            image = screenshot(label)
            x, y = window()["at"]
            width, height = window()["size"]
            expected = tuple(bytes.fromhex(role(name).lstrip("#")))
            # Mid-edge samples avoid rounding/antialiasing at corners.
            samples = [image.getpixel((x - 1, y + height // 2)), image.getpixel((x + width, y + height // 2))]
            # Renderer color conversion/dithering can move an 8-bit channel by
            # a few levels. This still sharply distinguishes all three roles.
            assert all(max(abs(a - b) for a, b in zip(pixel, expected)) <= 3 for pixel in samples), (label, samples, expected)
            assert "int: 2" in control("getoption", "general:border_size")
            released = mode() == "winkeytoggle"
            active_role = "accent-primary" if released else "accent-secondary"
            inactive_role = "accent-primary" if released else "divider-subtle"
            assert "ff" + role(active_role).lstrip("#") in control("getoption", "general:col.active_border")
            assert "ff" + role(inactive_role).lstrip("#") in control("getoption", "general:col.inactive_border")

        reset_geometry()
        assert mode() == "default"
        border("accent-secondary", "normal-floating")
        toggle("winkeytoggle")
        border("accent-primary", "released-floating")
        for button in (272, 273):
            drag(button, True)
        # A real ordinary Win shortcut (float toggle) must reach the client instead.
        wire.keys.clear()
        wire.chord(65, 57)  # Super+Shift+Space
        assert window()["floating"] and any(event[2] == 57 for event in wire.keys), (window()["floating"], wire.keys, control("activewindow", "-j"))
        for key in (115, 114, 113, 164, 163, 165, 99):
            wire.chord(0, key)  # volume, mute, transport and Print Screen
        commands = (root / "commands").read_text().splitlines()
        assert len(commands) == 7, commands
        toggle("default")
        for key in (115, 114, 113, 164, 163, 165, 99):
            wire.chord(0, key)
        assert (root / "commands").read_text().splitlines() == commands * 2
        border("accent-secondary", "restored-floating")
        for button in (272, 273):
            drag(button, False)
        reset_geometry()
        wire.chord(65, 57)
        assert not window()["floating"], "Normal Win shortcut was not restored"
        border("accent-secondary", "normal-tiled")
        toggle("winkeytoggle")
        border("accent-primary", "released-tiled")
        # Focus changes must not reset the mode/indicator. A second same-fixture
        # surface supplies an inactive bordered window without launching host apps.
        other = WaylandFixture(root / "wayland-1")
        try:
            other.setup(with_input=False)
            wire.settle(0.2)
            assert mode() == "winkeytoggle"
            # The first window is inactive: both borders must be rose while
            # released, restoring the normal inactive tint on exit and reload.
            border("accent-primary", "released-inactive-tiled")
            toggle("default")
            border("divider-subtle", "restored-inactive-tiled")
            toggle("winkeytoggle")
            assert control("reload", "config-only") == "ok"
            wire.settle(0.2)
            assert mode() == "default"
            border("divider-subtle", "reloaded-inactive-tiled")
            toggle("winkeytoggle")
            dispatch("hl.dsp.focus({window='address:" + window()["address"] + "'})")
            border("accent-primary", "refocused-tiled")
        finally:
            other.socket.close()
            wire.settle(0.2)
        dispatch("hl.dsp.window.fullscreen({mode='fullscreen',action='set'})")
        fullscreen_geometry = geometry()
        assert fullscreen_geometry == ([0, 0], [1280, 720])
        image = screenshot("released-fullscreen")
        # Native fullscreen has no border. Keep it that way rather than forcing
        # decorations for this indicator; an edge pixel remains client content.
        assert max(image.getpixel((0, 360))) - min(image.getpixel((0, 360))) <= 3
        for button in (272, 273):
            wire.move(400, 350)
            wire.buttons.clear()
            wire.modifiers(64)
            wire.button(button, True)
            wire.move(480, 390)
            wire.button(button, False)
            wire.modifiers(0)
            assert geometry() == fullscreen_geometry
            assert [(event[2], event[3]) for event in wire.buttons] == [(button, 1), (button, 0)]
        dispatch("hl.dsp.window.fullscreen({mode='fullscreen',action='unset'})")
        assert control("reload", "config-only") == "ok"
        wire.settle(0.3)
        assert not control("configerrors") and mode() == "default"
        reset_geometry()
        border("accent-secondary", "reloaded-normal")
        toggle("winkeytoggle")
        drag(272, True)
        toggle("default")
        drag(272, False)
        # Upgrade an already-active old submap, then reload the new configuration.
        with fixture_config.open("a") as output:
            output.write('\nhl.define_submap("gaming", function() hl.bind("Escape", hl.dsp.submap("reset")) end)\n')
        assert control("reload", "config-only") == "ok"
        wire.settle(0.2)
        dispatch("hl.dsp.submap('gaming')")
        fixture_config.write_text(fixture_config.read_text().rsplit('\nhl.define_submap("gaming"', 1)[0])
        assert control("reload", "config-only") == "ok"
        wire.settle(0.2)
        assert mode() == "default"
        border("accent-secondary", "legacy-reload-normal")
        print("winkeytoggle real input/render: pointer passthrough, normal drag/resize, keyboard/media/Print, focus, tiled/floating/fullscreen, reload and migration passed.")
    finally:
        if wire:
            if wire.controller:
                wire.controller.socket.close()
            wire.socket.close()
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        for log in logs:
            log.close()


if __name__ == "__main__":
    if sys.argv[1] == "--bridge":
        parent_bridge(Path(sys.argv[2]))
    else:
        # Keep socket paths short enough for Hyprland's long instance signature.
        root = Path(tempfile.mkdtemp(prefix="wk", dir="/tmp"))
        try:
            run_tests(Path(sys.argv[1]).resolve(), root)
        except BaseException:
            print("Retained isolated failure artifacts:", root, file=sys.stderr)
            raise
        else:
            if os.environ.get("WINKEYTOGGLE_KEEP_ARTIFACTS") == "1":
                print("Isolated logs and border screenshots:", root)
            else:
                shutil.rmtree(root)
