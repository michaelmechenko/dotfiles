#!/usr/bin/env python3
"""Real-fzf regression flows for tmux-open-picker (stdlib only).

fzf is run against the exact opaque-ID rows used by the popup. Its filter mode
keeps this suite noninteractive while exercising fzf's matcher and the picker
selection boundary deterministically.
"""
import importlib.machinery
import importlib.util
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(HERE, "tmux-open-picker")


def load():
    loader = importlib.machinery.SourceFileLoader("picker_fzf", MODULE)
    spec = importlib.util.spec_from_loader("picker_fzf", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def filtered_row(module, candidates, query):
    result = subprocess.run(
        ["fzf", "--ansi", "--filter", query, "--delimiter=\\t", "--with-nth=2.."],
        input="\n".join(module.candidate_rows(candidates)) + "\n",
        text=True, capture_output=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout.splitlines()[0]


def check(label, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + label + (" " + detail if detail else ""))
    return 0 if condition else 1


def main():
    module = load()
    root = tempfile.mkdtemp(prefix="picker-fzf-")
    open(os.path.join(root, "main.rs"), "w").close()
    os.mkdir(os.path.join(root, "docs"))
    failures = 0

    candidates = module.build_candidates("https://a.com https://ab.com main.rs docs/", root)
    row = filtered_row(module, candidates, "ab.com")
    action, selected = module.decode_fzf_selection("enter\n" + row + "\n", candidates)
    failures += check("filter-to-one dispatches exact visible URL",
                      action == "open" and selected.target == "https://ab.com", repr(selected))

    for key, expected, query in [
        ("ctrl-y", "copy", "https://a.com"),
        ("ctrl-f", "finder", "main.rs"),
        ("ctrl-n", "nvim", "main.rs"),
    ]:
        row = filtered_row(module, candidates, query)
        action, selected = module.decode_fzf_selection(key + "\n" + row + "\n", candidates)
        failures += check("%s direct action" % expected, action == expected, repr(selected))

    for name, content in [
        ("url-only", "https://example.com/" + "x" * 300),
        ("path-only", "main.rs"),
        ("mixed", "https://a.com main.rs docs/"),
    ]:
        rows = module.candidate_rows(module.build_candidates(content, root))
        failures += check("render %s rows" % name,
                          bool(rows) and all("\t" in row for row in rows), repr(rows))
    failures += check("empty has explicit no candidates", not module.build_candidates("", root))
    failures += check("no-match is explicit", filtered_row(module, candidates, "definitely-no-match") is None)

    # Failure visibility: inner must return nonzero and publish the adapter's
    # stderr rather than detaching it through a background Popen.
    module.capture_pane = lambda pane: "https://a.com"
    module.pane_cwd = lambda pane: root
    module._fzf = lambda items: ("copy", items[0])
    module.dispatch = lambda action, pane, candidate: subprocess.CompletedProcess([], 37, "", "forced copy failure")
    notices = []
    module._notice = notices.append
    failures += check("failed action is visible and nonzero", module.inner("%9") == 1 and notices == ["forced copy failure"], repr(notices))
    module._fzf = lambda items: (_ for _ in ()).throw(FileNotFoundError("fzf not found"))
    notices.clear()
    failures += check("missing fzf is visible and nonzero", module.inner("%9") == 1 and notices == ["fzf not found"], repr(notices))

    print("fails=%d" % failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
