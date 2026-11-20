#!/usr/bin/env python3
"""Generate assets/cv.pdf from cv.html, typeset like the LaTeX CV.

Single source of truth: the content is parsed out of cv.html (titles, dates,
"Supervised by" lines, descriptions, list sections), so editing the web CV
updates the PDF on the next run. Typeface is Latin Modern (Computer Modern),
embedded from the site's own font sources.

Usage:
    PYTHONPATH=<dir with fpdf2+fonttools> python3 scripts/build-cv-pdf.py
The lmroman OTFs are looked up in scripts/fonts/ (preferred) or a scratch dir.

Layout notes (matched against "Leon Lufkin CV.pdf"):
  - US Letter, ~1in side margins, centered 21pt name, centered contact line
  - Section headings: bold title-case, NO rule
  - Entries: bold org left + date right; "– Supervised by ..." hanging items;
    description lines align under the text after the dash, no dash
  - Publications numbered [P9]..[P1], talks [T6]..[T1]; other lists get "–"
  - Centered page numbers
"""
import os, re, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "cv.pdf")

# ---------------------------------------------------------------- fonts ----
FONT_DIRS = [
    os.path.join(ROOT, "scripts", "fonts"),
    "/private/tmp/claude-501/-Users-leonlufkin-Documents-GitHub-leonlufkin-github-io/9e239b75-f596-4e14-b14f-4419e8a66efb/scratchpad/fonts",
]
def font(path):
    for d in FONT_DIRS:
        p = os.path.join(d, path)
        if os.path.exists(p):
            return p
    raise SystemExit("font not found: %s (looked in %s)" % (path, FONT_DIRS))

# ---------------------------------------------------------------- parse ----
# Minimal extractor tuned to cv.html's controlled markup. Text segments carry
# italic/underline flags and a URL so inline formatting and links survive.

class Seg(tuple):
    pass  # (text, italic, underline, link)

class CVParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.name = self.contact = ""
        self.sections = []   # [(heading, [blocks])]
        self._sec = None
        self._stack = []     # element class context
        self._buf = None     # list of (text, italic, underline, link)
        self._em = 0
        self._links = []
        self._item = None    # current cv-item dict
        self._li = None      # current list item {"segs": [], "date": ""}
        self._mode = None    # what the current buffer is for

    # -- helpers
    def _cls(self, attrs):
        return (dict(attrs).get("class") or "").split()

    def _start_buf(self, mode):
        self._buf, self._mode, self._em = [], mode, 0
        self._links = []
        self._nest = 0  # nested inline spans (e.g. class="me") within a capture

    def _text(self):
        segs = [s for s in self._buf or [] if s[0]]
        # collapse whitespace across segments
        out, prev_sp = [], True
        for t, i, ul, link in segs:
            t = re.sub(r"\s+", " ", t)
            if prev_sp:
                t = t.lstrip()
            if t:
                out.append((t, i, ul, link))
                prev_sp = t.endswith(" ")
        if out:
            last, i, ul, link = out[-1]
            out[-1] = (last.rstrip(), i, ul, link)
        return [s for s in out if s[0]]

    # -- events
    def handle_starttag(self, tag, attrs):
        c = self._cls(attrs)
        self._stack.append((tag, c))
        if tag == "h1" and "screen-only" not in c and any("cv-printhead" in cc for _, cc in self._stack[:-1]):
            self._start_buf("name")
        elif tag == "p" and any("cv-printhead" in cc for _, cc in self._stack[:-1]):
            self._start_buf("contact")
        elif tag == "h2":
            self._start_buf("h2")
        elif tag == "div" and "cv-item" in c:
            self._item = {"title": [], "date": "", "rows": []}
        elif self._item is not None and tag == "p" and "cv-title" in c:
            self._start_buf("title")
        elif self._item is not None and tag == "p" and "cv-sub" in c:
            if "cv-split" in c:
                self._item["rows"].append({"kind": "split", "sup": [], "date": ""})
                self._mode = "split-wait"
            elif "cv-sup" in c:
                self._start_buf("sup")
            else:
                self._start_buf("desc")
        elif self._mode == "split-wait" and tag == "span":
            if "cv-sup" in c:
                self._start_buf("split-sup")
            else:
                self._start_buf("split-date")
        elif self._item is not None and tag == "span" and "cv-date" in c:
            self._start_buf("item-date")
        elif self._item is not None and tag == "span" and "cv-sub" in c:
            self._start_buf("extra")   # e.g. GPA under the date column
        elif tag == "ul" and "cv-list" in c:
            self._sec_block(("list", []))
            self._mode = "list"
        elif tag == "li" and self._in_list():
            self._li = {"segs": [], "date": ""}
        elif self._li is not None and tag == "span":
            if self._buf is not None:
                self._nest += 1  # inline span inside the text, keep capturing
            elif "cv-date" in c:
                self._start_buf("li-date")
            else:
                self._start_buf("li-text")
        elif tag == "p" and "cv-prose" in c:
            self._start_buf("prose")
        elif tag == "em" and self._buf is not None:
            self._em += 1
        elif tag == "a" and self._buf is not None:
            self._links.append(dict(attrs).get("href") or "")

    def handle_endtag(self, tag):
        if self._stack:
            self._stack.pop()
        if tag == "em" and self._buf is not None:
            self._em = max(0, self._em - 1)
            return
        if tag == "a" and self._buf is not None:
            if self._links:
                self._links.pop()
            return  # an inline link must not end the enclosing text capture
        if tag == "span" and self._buf is not None and getattr(self, "_nest", 0) > 0:
            self._nest -= 1  # closing an inline span, not the capture
            return
        if self._buf is None:
            if tag == "p" and self._mode == "split-wait" and self._item is not None:
                row = self._item["rows"][-1]
                row["kind"] = "sup"
                row["segs"] = row.pop("sup")
                self._mode = None
            if tag == "li" and self._li is not None:
                self._cur_list().append(self._li)
                self._li = None
            if tag == "div" and self._item is not None and not self._in(("div", "cv-item")):
                self._sec_block(("item", self._item))
                self._item = None
            if tag == "ul" and self._mode == "list":
                self._mode = None
            return
        segs, mode = self._text(), self._mode
        plain = "".join(s[0] for s in segs)
        if mode == "name":
            self.name = plain
        elif mode == "contact":
            self.contact = plain
        elif mode == "h2":
            self.sections.append((plain, []))
            self._sec = self.sections[-1][1]
        elif mode == "title":
            self._item["title"] = segs
        elif mode == "sup":
            self._item["rows"].append({"kind": "sup", "segs": segs, "date": ""})
        elif mode == "desc":
            self._item["rows"].append({"kind": "desc", "segs": segs})
        elif mode == "split-sup":
            self._item["rows"][-1]["sup"] = segs
            self._mode = "split-wait"
            self._buf = None
            return
        elif mode == "split-date":
            self._item["rows"][-1]["date"] = plain
            self._mode = "split-wait"
            self._buf = None
            return
        elif mode == "item-date":
            self._item["date"] = plain
        elif mode == "extra":
            self._item["rows"].append({"kind": "desc", "segs": segs})
        elif mode == "li-text":
            self._li["segs"] = segs
        elif mode == "li-date":
            self._li["date"] = plain
        elif mode == "prose":
            self._sec_block(("prose", segs))
        self._buf, self._mode = None, None
        if tag == "li" and self._li is not None:
            self._cur_list().append(self._li)
            self._li = None
        if tag == "div" and self._item is not None and not self._in(("div", "cv-item")):
            self._sec_block(("item", self._item))
            self._item = None
        if tag == "p" and self._item is not None and self._item["rows"] and \
           self._item["rows"][-1].get("kind") == "split":
            self._item["rows"][-1]["kind"] = "sup"
            self._item["rows"][-1]["segs"] = self._item["rows"][-1].pop("sup")

    def handle_data(self, data):
        if self._buf is not None:
            self._buf.append((data, self._em > 0, False,
                              self._links[-1] if self._links else ""))
        if self._li is not None and self._buf is None:
            pass

    # -- structure helpers
    def _in(self, needle):
        return any(t == needle[0] and needle[1] in c for t, c in self._stack)

    def _in_list(self):
        return self._in(("ul", "cv-list"))

    def _sec_block(self, block):
        if self._sec is None:
            self.sections.append(("", []))
            self._sec = self.sections[-1][1]
        self._sec.append(block)

    def _cur_list(self):
        for kind, payload in reversed(self._sec):
            if kind == "list":
                return payload
        raise RuntimeError("li outside list")


def parse_cv():
    src = open(os.path.join(ROOT, "cv.html"), encoding="utf-8").read()
    p = CVParser()
    p.feed(src)
    return p

# ---------------------------------------------------------------- render ---
from fpdf import FPDF

PAGE_W, PAGE_H = 612, 792          # US Letter, points
MARGIN = 68
TOP = 64
BOTTOM = 60
BODY = 10.5
LEAD = 13.4
DASH_X = MARGIN + 13
TEXT_X = MARGIN + 26
NUM_X = MARGIN                      # [P7] hangs at the margin
NUM_TEXT_X = MARGIN + 30

class CVPDF(FPDF):
    def footer(self):
        self.set_y(-40)
        self.set_font("LM", "", 10)
        self.cell(0, 10, str(self.page_no()), align="C")

NAME = "Leon Lufkin"

def underline_name(segs):
    """Split segments so occurrences of the name carry an underline flag."""
    out = []
    for seg in segs:
        t, it = seg[0], seg[1]
        link = seg[3] if len(seg) > 3 else ""
        parts = t.split(NAME)
        for i, part in enumerate(parts):
            if part:
                out.append((part, it, False, link))
            if i < len(parts) - 1:
                out.append((NAME, it, True, link))
    return out

def seg_width(pdf, segs, size=BODY):
    w = 0.0
    for seg in segs:
        t, it = seg[0], seg[1]
        pdf.set_font("LM", "I" if it else "", size)
        w += pdf.get_string_width(t)
    return w

def wrapped_lines(pdf, segs, width, size=BODY, bold=False):
    """Wrap complete words across inline style/link boundaries.

    An opening quote outside <a> and the linked word following it are one
    unbreakable unit, as are a linked final word and its closing punctuation.
    Separate write() calls cannot determine those boundaries themselves.
    """
    words, word, spaces = [], [], []
    for seg in segs:
        for token in re.findall(r"\s+|\S+", seg[0]):
            part = (token, *seg[1:])
            if token.isspace():
                if word:
                    words.append((spaces, word))
                    spaces, word = [], []
                spaces.append(part)
            else:
                word.append(part)
    if word:
        words.append((spaces, word))

    def measure(parts):
        total = 0.0
        for part in parts:
            pdf.set_font("LM", ("B" if bold else "") + ("I" if part[1] else ""), size)
            total += pdf.get_string_width(part[0])
        return total

    lines, line, used = [], [], 0.0
    # fpdf.write reserves a cell margin at each edge of the logical line.
    available = width - 2 * pdf.c_margin
    for spaces, word in words:
        word_width = measure(word)
        space_width = measure(spaces) if line else 0.0
        if line and used + space_width + word_width > available:
            lines.append(line)
            line, used = [], 0.0
        if line:
            line.extend(spaces)
            used += space_width
        line.extend(word)
        used += word_width
    if line:
        lines.append(line)
    return lines or [[]]


def est_lines(pdf, segs, width, size=BODY, bold=False):
    return len(wrapped_lines(pdf, segs, width, size, bold))

def write_segs(pdf, segs, x, right_reserve=0.0, size=BODY, bold=False):
    """Flow segments starting at x; wrapped lines return to x."""
    y0 = pdf.get_y()
    pdf.set_left_margin(x)
    pdf.set_right_margin(MARGIN + right_reserve)
    pdf.set_xy(x, y0)
    lines = wrapped_lines(pdf, segs, PAGE_W - x - MARGIN - right_reserve, size, bold)
    for line in lines:
        # Merge adjacent fragments of the same style/URL to keep annotations
        # compact and avoid artificial word breaks at HTML tag boundaries.
        merged = []
        for part in line:
            if merged and part[1:] == merged[-1][1:]:
                merged[-1] = (merged[-1][0] + part[0], *part[1:])
            else:
                merged.append(part)
        for seg in merged:
            t, it = seg[0], seg[1]
            ul = seg[2] if len(seg) > 2 else False
            link = seg[3] if len(seg) > 3 else ""
            style = ("B" if bold else "") + ("I" if it else "") + ("U" if ul else "")
            pdf.set_font("LM", style, size)
            pdf.write(LEAD, t, link=link)
        pdf.ln(LEAD)
    pdf.set_left_margin(MARGIN)
    pdf.set_right_margin(MARGIN)
    return y0

def line_with_date(pdf, segs, date, x, size=BODY, bold=False, dash=None, num=None):
    """One logical row: optional dash/number marker, flowed text, date right."""
    date_w = 0.0
    if date:
        pdf.set_font("LM", "", size)
        date_w = pdf.get_string_width(date) + 10
    # keep-together check
    width = PAGE_W - x - MARGIN - date_w
    n = est_lines(pdf, segs, width, size, bold)
    if pdf.get_y() + n * LEAD > PAGE_H - BOTTOM:
        pdf.add_page()
    y0 = pdf.get_y()
    if dash:
        pdf.set_font("LM", "", size)
        pdf.text(DASH_X, y0 + LEAD * 0.75, "–")
    if num:
        pdf.set_font("LM", "", size)
        pdf.text(NUM_X, y0 + LEAD * 0.75, num)
    write_segs(pdf, segs, x, right_reserve=date_w, size=size, bold=bold)
    y_after = pdf.get_y()  # bottom of the wrapped text block
    if date:
        pdf.set_font("LM", "", size)
        pdf.set_xy(PAGE_W - MARGIN - date_w, y0)
        pdf.cell(date_w, LEAD, date, align="R")
    pdf.set_xy(MARGIN, y_after)
    return y0

def build():
    cv = parse_cv()
    pdf = CVPDF(unit="pt", format="letter")
    pdf.set_auto_page_break(True, margin=BOTTOM)
    pdf.set_margins(MARGIN, TOP, MARGIN)
    pdf.add_font("LM", "", font("lmroman10-regular.otf"))
    pdf.add_font("LM", "B", font("lmroman10-bold.otf"))
    pdf.add_font("LM", "I", font("lmroman10-italic.otf"))
    pdf.add_font("LM", "BI", font("lmroman10-bolditalic.otf"))
    pdf.set_title(cv.name + " — CV")
    pdf.add_page()

    # name + contact, centered
    pdf.set_font("LM", "B", 21)
    pdf.cell(0, 26, cv.name, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("LM", "", BODY)
    for part in cv.contact.split("·"):
        pdf.cell(0, LEAD, part.strip(), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pubs_n = talks_n = None
    for heading, blocks in cv.sections:
        if not heading:
            continue
        # heading (keep with following content)
        if pdf.get_y() + 3 * LEAD + 18 > PAGE_H - BOTTOM:
            pdf.add_page()
        pdf.ln(7)
        pdf.set_font("LM", "B", 12.5)
        pdf.cell(0, 16, heading, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        numbered = None
        if heading.lower().startswith("publication"):
            numbered = "P"
        elif heading.lower().startswith("talks"):
            numbered = "T"

        for kind, payload in blocks:
            if kind == "item":
                it = payload
                line_with_date(pdf, it["title"], it["date"],
                               MARGIN, bold=True)
                edu = heading.lower().startswith("education")
                for row in it["rows"]:
                    if row["kind"] == "sup":
                        # supervisor / role lines are italic, as on the site
                        ital = [(s[0], True, s[2], s[3]) for s in row["segs"]]
                        line_with_date(pdf, ital, row.get("date", ""),
                                       TEXT_X, dash=True)
                    else:
                        # in Education the degree line is a dashed item, like
                        # the LaTeX CV; elsewhere it's a continuation line
                        line_with_date(pdf, row["segs"], "", TEXT_X, dash=edu)
                pdf.ln(4)
            elif kind == "prose":
                line_with_date(pdf, payload, "", MARGIN)
                pdf.ln(2)
            elif kind == "list":
                total = len(payload)
                for idx, li in enumerate(payload):
                    lsegs = underline_name(li["segs"])
                    if numbered:
                        tag = "[%s%d]" % (numbered, total - idx)
                        line_with_date(pdf, lsegs, li["date"], NUM_TEXT_X,
                                       num=tag)
                    else:
                        line_with_date(pdf, lsegs, li["date"], TEXT_X,
                                       dash=True)
                    pdf.ln(1.5)
                pdf.ln(2)

    pdf.output(OUT)
    print("wrote %s (%d pages, %.0f KB)" %
          (os.path.relpath(OUT, ROOT), pdf.page_no(), os.path.getsize(OUT) / 1024))

if __name__ == "__main__":
    build()
