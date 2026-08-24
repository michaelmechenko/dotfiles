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
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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


class UnifiedFzfModel(unittest.TestCase):
    """Regression guards for the opaque-ID unified fzf boundary."""

    def setUp(self):
        self.m = load_module()
        self.root = make_tree()

    def test_global_terminal_appearance_order(self):
        candidates = self.m.build_candidates(
            "src/main.rs then https://example.com then docs/", self.root)
        self.assertEqual([c.kind for c in candidates], ["file", "url", "dir"])
        self.assertEqual([c.label for c in candidates],
                         ["src/main.rs", "https://example.com", "docs/"])

    def test_valid_quoted_path_beats_github_shorthand(self):
        os.makedirs(os.path.join(self.root, "user", "repo"))
        candidates = self.m.build_candidates("'user/repo'", self.root)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].kind, "dir")
        self.assertEqual(candidates[0].target, os.path.join(self.root, "user", "repo"))

    def test_github_shorthand_is_url_without_existing_path(self):
        candidates = self.m.build_candidates("'user/repo'", self.root)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].kind, "url")
        self.assertEqual(candidates[0].target, "https://github.com/user/repo")

    def test_rows_only_expose_safe_opaque_ids(self):
        candidates = self.m.build_candidates("https://a.com src/main.rs", self.root)
        rows = self.m.candidate_rows(candidates)
        self.assertEqual([row.split("\t", 1)[0] for row in rows], ["0", "1"])
        self.assertTrue(all("\t" in row for row in rows))
        self.assertTrue(all("URL " in self.m.strip_ansi(row) or "FILE " in self.m.strip_ansi(row)
                            for row in rows))

    def test_trailing_commas_are_removed_from_labels_not_payloads(self):
        candidates = self.m.build_candidates("notes.txt, docs, src/main.rs,", self.root)
        self.assertEqual([candidate.label for candidate in candidates],
                         ["notes.txt", "docs", "src/main.rs"])
        self.assertEqual([candidate.target for candidate in candidates], [
            os.path.join(self.root, "notes.txt"),
            os.path.join(self.root, "docs"),
            os.path.join(self.root, "src", "main.rs"),
        ])

    def test_tag_only_colors_keep_ids_and_labels_unstyled(self):
        candidates = self.m.build_candidates("https://a.com notes.txt docs/", self.root)
        palette = {"url": "#8ba9c1", "file": "#bb9dbd", "dir": "#aeaed1"}
        rows = self.m.candidate_rows(candidates, palette)
        self.assertEqual([row.split("\t", 1)[0] for row in rows], ["0", "1", "2"])
        self.assertEqual(rows, [
            "0\t\x1b[38;2;139;169;193mURL\x1b[0m  https://a.com",
            "1\t\x1b[38;2;187;157;189mFILE\x1b[0m  notes.txt",
            "2\t\x1b[38;2;174;174;209mDIR\x1b[0m  docs/",
        ])

    def test_palette_is_read_once_with_role_fallbacks(self):
        completed = subprocess.CompletedProcess(
            [], 0, "#123456\t#abcdef\t#fedcba\n", "")
        with patch.object(self.m.subprocess, "run", return_value=completed) as run:
            self.assertEqual(self.m.tag_colors(), {
                "url": "#123456", "file": "#abcdef", "dir": "#fedcba"})
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][:3], ["tmux", "display-message", "-p"])

    def test_selection_uses_visible_row_id_not_pre_filter_index(self):
        candidates = self.m.build_candidates("https://a.com https://ab.com", self.root)
        rows = self.m.candidate_rows(candidates)
        # fzf's post-filter selected row must dispatch its opaque ID, never a
        # cursor retained from the unfiltered candidate list.
        action, selected = self.m.decode_fzf_selection("enter\n" + rows[1] + "\n", candidates)
        self.assertEqual(action, "open")
        self.assertEqual(selected.target, "https://ab.com")

    def test_action_keys_are_direct_and_type_checked(self):
        candidates = self.m.build_candidates("https://a.com src/main.rs docs/", self.root)
        self.assertEqual(self.m.action_for("enter", candidates[0]), "open")
        self.assertEqual(self.m.action_for("ctrl-y", candidates[0]), "copy")
        self.assertEqual(self.m.action_for("ctrl-f", candidates[1]), "finder")
        self.assertEqual(self.m.action_for("ctrl-n", candidates[1]), "nvim")
        self.assertIsNone(self.m.action_for("ctrl-f", candidates[0]))

    def test_safe_path_payloads_survive_display_sanitization(self):
        names = ["space name.txt", "quo'te.txt", "semi;$.txt", "tab\tname.txt", "-leading.txt"]
        for name in names:
            open(os.path.join(self.root, name), "w").close()
        text = " ".join('"%s"' % name for name in names)
        candidates = self.m.build_candidates(text, self.root)
        self.assertEqual({c.target for c in candidates}, {os.path.join(self.root, name) for name in names})
        rows = self.m.candidate_rows(candidates)
        self.assertTrue(any("tab\\tname.txt" in row for row in rows))
        self.assertFalse(any("\n" in row for row in rows))

    def test_unknown_or_tampered_selection_is_rejected(self):
        candidates = self.m.build_candidates("https://a.com", self.root)
        with self.assertRaises(ValueError):
            self.m.decode_fzf_selection("enter\n999\tURL forged\n", candidates)
        with self.assertRaises(ValueError):
            self.m.decode_fzf_selection("ctrl-f\n0\tURL https://a.com\n", candidates)


if __name__ == "__main__":
    unittest.main(verbosity=2)
