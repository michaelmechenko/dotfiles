#!/usr/bin/env python3
"""Unit tests for tmux-open-picker extraction/classification (stdlib unittest, no deps).

Run: python3 tmux_scripts/tmux-open-picker-test.py
Covers the M-o seam: URL extraction, path candidate extraction against a pane cwd,
relative-path resolution, directories, extensionless/hidden files, quoted paths,
file:line suffixes, duplicates, invalid candidates, and action dispatch.

These are red until tmux-open-picker implements the documented functions.
"""
import importlib.machinery
import importlib.util
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(HERE, "tmux-open-picker")


def load_module():
    loader = importlib.machinery.SourceFileLoader("tmux_open_picker", MODULE)
    spec = importlib.util.spec_from_loader("tmux_open_picker", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def make_tree():
    """Build a throwaway tree of files/dirs to validate filesystem resolution."""
    root = tempfile.mkdtemp(prefix="tmux-open-picker-test-")
    os.makedirs(os.path.join(root, "src"))
    os.makedirs(os.path.join(root, "docs"))
    open(os.path.join(root, "src", "main.rs"), "w").close()
    open(os.path.join(root, "notes.txt"), "w").close()
    open(os.path.join(root, "docs", "my file.md"), "w").close()
    open(os.path.join(root, "Makefile"), "w").close()
    open(os.path.join(root, ".zshrc"), "w").close()
    return root


class UrlExtraction(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_https(self):
        self.assertEqual(self.m.extract_urls("visit https://example.com today"), ["https://example.com"])

    def test_http(self):
        self.assertEqual(self.m.extract_urls("visit http://example.com today"), ["http://example.com"])

    def test_ftp(self):
        self.assertEqual(self.m.extract_urls("download ftp://files.example.com/file.tar.gz"),
                         ["ftp://files.example.com/file.tar.gz"])

    def test_file_scheme(self):
        self.assertEqual(self.m.extract_urls("open file:///home/user/doc.pdf"), ["file:///home/user/doc.pdf"])

    def test_query_and_fragment(self):
        self.assertEqual(self.m.extract_urls("https://example.com/path?q=1&r=2#section"),
                         ["https://example.com/path?q=1&r=2#section"])

    def test_trailing_period_stripped(self):
        self.assertEqual(self.m.extract_urls("Visit https://example.com."), ["https://example.com"])

    def test_trailing_comma_stripped(self):
        self.assertEqual(self.m.extract_urls("See https://example.com, and more"), ["https://example.com"])

    def test_multiple_on_line(self):
        self.assertEqual(self.m.extract_urls("https://a.com and https://b.com"),
                         ["https://a.com", "https://b.com"])

    def test_git_ssh(self):
        self.assertEqual(self.m.extract_urls("git@github.com:user/repo.git"),
                         ["https://github.com/user/repo.git"])

    def test_ssh_prefix_git(self):
        self.assertEqual(self.m.extract_urls("ssh://git@github.com/user/repo.git"),
                         ["https://github.com/user/repo.git"])

    def test_bare_www(self):
        self.assertEqual(self.m.extract_urls("visit www.example.com"), ["http://www.example.com"])

    def test_bare_ip(self):
        self.assertEqual(self.m.extract_urls("connect to 192.168.1.1"), ["http://192.168.1.1"])

    def test_ip_port_path(self):
        self.assertEqual(self.m.extract_urls("api at 10.0.0.1:3000/api/v1"), ["http://10.0.0.1:3000/api/v1"])

    def test_github_shorthand_single(self):
        self.assertEqual(self.m.extract_urls("'user/repo'"), ["https://github.com/user/repo"])

    def test_github_shorthand_double(self):
        self.assertEqual(self.m.extract_urls('"user/repo"'), ["https://github.com/user/repo"])

    def test_dedup(self):
        self.assertEqual(self.m.extract_urls("https://example.com\nhttps://example.com\nhttps://example.com"),
                         ["https://example.com"])

    def test_https_www_not_duplicated(self):
        self.assertEqual(self.m.extract_urls("https://www.example.com"), ["https://www.example.com"])

    def test_ansi_wrapped(self):
        self.assertEqual(self.m.extract_urls("\x1b[32mhttps://example.com\x1b[0m"), ["https://example.com"])

    def test_empty(self):
        self.assertEqual(self.m.extract_urls(""), [])

    def test_order_by_appearance(self):
        self.assertEqual(self.m.extract_urls("visit https://example.com and www.test.com and 192.168.1.1"),
                         ["https://example.com", "http://www.test.com", "http://192.168.1.1"])


class PathExtraction(unittest.TestCase):
    def setUp(self):
        self.m = load_module()
        self.root = make_tree()

    def _candidates(self, text):
        return self.m.extract_path_candidates(text, self.root)

    def _displays(self, text):
        return [c["display"] for c in self._candidates(text)]

    def test_relative_with_extension(self):
        cs = self._candidates("see src/main.rs here")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))
        self.assertFalse(cs[0]["is_dir"])

    def test_dot_slash_relative(self):
        cs = self._candidates("open ./notes.txt now")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "notes.txt"))

    def test_quoted_path_with_space(self):
        cs = self._candidates("edit 'docs/my file.md' please")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "docs", "my file.md"))
        self.assertEqual(cs[0]["display"], "docs/my file.md")

    def test_directory_trailing_slash(self):
        cs = self._candidates("cd docs/")
        self.assertEqual(len(cs), 1)
        self.assertTrue(cs[0]["is_dir"])
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "docs"))

    def test_extensionless_file(self):
        cs = self._candidates("make from Makefile")
        self.assertEqual(len(cs), 1)
        self.assertEqual(os.path.basename(cs[0]["path"]), "Makefile")

    def test_hidden_file(self):
        cs = self._candidates("source .zshrc")
        self.assertEqual(len(cs), 1)
        self.assertEqual(os.path.basename(cs[0]["path"]), ".zshrc")

    def test_line_suffix(self):
        cs = self._candidates("src/main.rs:42:7 boom")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["line"], "42")

    def test_home_expansion(self):
        # ~/.zshrc resolves to the user's home zshrc which exists in this repo
        cs = self.m.extract_path_candidates("~/.zshrc", os.getcwd())
        # may or may not exist depending on $HOME; only assert shape when found
        for c in cs:
            self.assertTrue(c["path"].startswith(os.path.expanduser("~")))

    def test_absolute_path(self):
        f = os.path.join(self.root, "notes.txt")
        cs = self._candidates("open " + f)
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], f)

    def test_nonexistent_omitted(self):
        self.assertEqual(self._candidates("see foobar.md now"), [])
        self.assertEqual(self._candidates("see src/missing.rs now"), [])

    def test_url_not_a_path(self):
        self.assertEqual(self._candidates("visit https://example.com today"), [])

    def test_dedup_by_resolved(self):
        cs = self._candidates("src/main.rs and src/main.rs again")
        self.assertEqual(len(cs), 1)

    def test_order_by_appearance(self):
        ds = self._displays("notes.txt then src/main.rs")
        self.assertEqual(ds, ["notes.txt", "src/main.rs"])

    def test_empty(self):
        self.assertEqual(self._candidates(""), [])

    # --- punctuation trimming (display text preserved, resolution uses trimmed) ---

    def test_paren_wrapped(self):
        cs = self._candidates("see (src/main.rs) here")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))
        self.assertEqual(cs[0]["display"], "(src/main.rs)")

    def test_bracket_wrapped(self):
        cs = self._candidates("see [src/main.rs] here")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_brace_wrapped(self):
        cs = self._candidates("see {src/main.rs} here")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_trailing_comma(self):
        cs = self._candidates("see src/main.rs, and more")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_trailing_period(self):
        cs = self._candidates("see src/main.rs.")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_trailing_semicolon(self):
        cs = self._candidates("see src/main.rs; next")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_paren_wrapped_with_line(self):
        cs = self._candidates("error at (src/main.rs:42)")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["line"], "42")
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_trailing_comma_with_line(self):
        cs = self._candidates("error at src/main.rs:42, fix it")
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["line"], "42")

    # --- parent-relative paths ---

    def test_parent_relative(self):
        cs = self.m.extract_path_candidates("see ../src/main.rs", os.path.join(self.root, "docs"))
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_parent_relative_with_line(self):
        cs = self.m.extract_path_candidates("see ../src/main.rs:7", os.path.join(self.root, "docs"))
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["line"], "7")
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_double_parent_relative(self):
        cs = self.m.extract_path_candidates("see ../../src/main.rs", os.path.join(self.root, "docs", "sub"))
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    # --- multi-root resolution (parent chain) ---

    def test_resolves_via_parent(self):
        # src/main.rs from root/docs doesn't exist relative to docs, but the
        # parent chain tries root and finds root/src/main.rs.
        cs = self.m.extract_path_candidates("see src/main.rs", os.path.join(self.root, "docs"))
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_resolves_via_grandparent(self):
        os.makedirs(os.path.join(self.root, "docs", "sub"))
        cs = self.m.extract_path_candidates("see src/main.rs", os.path.join(self.root, "docs", "sub"))
        self.assertEqual(len(cs), 1)
        self.assertEqual(cs[0]["path"], os.path.join(self.root, "src", "main.rs"))

    def test_git_root_resolution(self):
        import subprocess
        subprocess.run(["git", "init", "-q", self.root], check=True, capture_output=True)
        # create a subdirectory two levels deep so git root differs from cwd
        deep = os.path.join(self.root, "a", "b")
        os.makedirs(deep)
        open(os.path.join(self.root, "src", "main.rs"), "w").close()
        cs = self.m.extract_path_candidates("see src/main.rs", deep)
        self.assertEqual(len(cs), 1)
        # git rev-parse returns the realpath (/private/var on macOS), so compare
        # via realpath to avoid /var vs /private/var symlink mismatch.
        self.assertEqual(os.path.realpath(cs[0]["path"]),
                         os.path.realpath(os.path.join(self.root, "src", "main.rs")))


class AnsiStrip(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_sgr_stripped(self):
        self.assertEqual(self.m.strip_ansi("\x1b[32mhi\x1b[0m there"), "hi there")

    def test_csi_stripped(self):
        self.assertEqual(self.m.strip_ansi("\x1b[?25l\x1b[2Jabc"), "abc")


class Classification(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_url_list_empty(self):
        self.assertEqual(self.m.extract_urls(""), [])

    def test_paths_need_cwd(self):
        root = make_tree()
        self.assertEqual(len(self.m.extract_path_candidates("src/main.rs", root)), 1)
        # Multi-root: src/main.rs from root/docs resolves via the parent root.
        self.assertEqual(len(self.m.extract_path_candidates("src/main.rs", os.path.join(root, "docs"))), 1)

    def test_path_not_found_anywhere(self):
        root = make_tree()
        # A path that exists in no root (cwd, git root, or any parent) is omitted.
        self.assertEqual(len(self.m.extract_path_candidates("nope/missing.rs", root)), 0)


class TrimPunctuation(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_parens(self):
        self.assertEqual(self.m._trim_punctuation("(src/main.rs)"), "src/main.rs")

    def test_brackets(self):
        self.assertEqual(self.m._trim_punctuation("[src/main.rs]"), "src/main.rs")

    def test_braces(self):
        self.assertEqual(self.m._trim_punctuation("{src/main.rs}"), "src/main.rs")

    def test_trailing_comma(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs,"), "src/main.rs")

    def test_trailing_period(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs."), "src/main.rs")

    def test_trailing_semicolon(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs;"), "src/main.rs")

    def test_trailing_bang(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs!"), "src/main.rs")

    def test_trailing_question(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs?"), "src/main.rs")

    def test_leading_dot_preserved(self):
        self.assertEqual(self.m._trim_punctuation("./foo"), "./foo")
        self.assertEqual(self.m._trim_punctuation(".zshrc"), ".zshrc")
        self.assertEqual(self.m._trim_punctuation("../bar"), "../bar")

    def test_tilde_preserved(self):
        self.assertEqual(self.m._trim_punctuation("~/foo"), "~/foo")

    def test_nested_wrapping(self):
        self.assertEqual(self.m._trim_punctuation("((src/main.rs))"), "src/main.rs")

    def test_empty_after_trim(self):
        self.assertEqual(self.m._trim_punctuation("(,)"), "")

    def test_no_change(self):
        self.assertEqual(self.m._trim_punctuation("src/main.rs"), "src/main.rs")


class ResolutionRoots(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_cwd_first(self):
        root = make_tree()
        roots = self.m._resolution_roots(root)
        self.assertEqual(roots[0], root)

    def test_parent_chain_no_git(self):
        root = make_tree()
        deep = os.path.join(root, "a", "b")
        os.makedirs(deep)
        roots = self.m._resolution_roots(deep)
        self.assertEqual(roots[0], deep)
        self.assertIn(os.path.join(root, "a"), roots)
        self.assertIn(root, roots)
        # / should never be a resolution root
        self.assertNotIn("/", roots)

    def test_git_root_included(self):
        import subprocess
        root = make_tree()
        subprocess.run(["git", "init", "-q", root], check=True, capture_output=True)
        deep = os.path.join(root, "a", "b")
        os.makedirs(deep)
        roots = self.m._resolution_roots(deep)
        self.assertEqual(roots[0], deep)
        self.assertIn(root, roots)
        # git root appears before parent chain entries
        self.assertLess(roots.index(root), len(roots))

    def test_dedup_when_parent_is_git_root(self):
        import subprocess
        root = make_tree()
        subprocess.run(["git", "init", "-q", root], check=True, capture_output=True)
        # cwd's parent IS the git root — should appear only once
        cwd = os.path.join(root, "src")
        roots = self.m._resolution_roots(cwd)
        self.assertEqual(roots.count(root), 1)


class MenuMapping(unittest.TestCase):
    """The path menu must map keys to tmux-open-target action keywords, not the
    single chars (regression guard: an earlier version returned 'n'/'f'/'c',
    which fell through tmux-open-target to legacy open)."""

    def setUp(self):
        import curses as _curses
        self.m = load_module()
        self.ENTER = _curses.KEY_ENTER

    def test_n_maps_nvim(self):
        self.assertEqual(self.m.menu_action_for_key(ord("n")), "nvim")

    def test_f_maps_finder(self):
        self.assertEqual(self.m.menu_action_for_key(ord("f")), "finder")

    def test_c_maps_copy(self):
        self.assertEqual(self.m.menu_action_for_key(ord("c")), "copy")

    def test_enter_defaults_nvim(self):
        self.assertEqual(self.m.menu_action_for_key(self.ENTER), "nvim")

    def test_unknown_returns_none(self):
        self.assertIsNone(self.m.menu_action_for_key(ord("x")))


if __name__ == "__main__":
    unittest.main(verbosity=2)