#!/usr/bin/env python3
"""Bangun design/plan.html: satu file mandiri (CSS ditanam) dari plan.src.html + plan.css.

Jalankan: python3 design/build-plan.py
Sumber kebenaran token tetap design/plan.css.
"""
from pathlib import Path

here = Path(__file__).resolve().parent
src = (here / "plan.src.html").read_text(encoding="utf-8")
css = (here / "plan.css").read_text(encoding="utf-8")

link = '<link rel="stylesheet" href="plan.css">'
if link not in src:
    raise SystemExit("Penanda <link rel=stylesheet href=plan.css> tidak ditemukan di plan.src.html")

out = src.replace(link, "<style>\n" + css + "</style>")
(here / "plan.html").write_text(out, encoding="utf-8")
print(f"plan.html ditulis: {len(out):,} karakter, CSS {len(css):,} karakter ditanam")
