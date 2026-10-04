#!/usr/bin/env python3
"""Checks a website translation catalog: python3 scripts/website/check_i18n.py <lang> [<lang> …]

Every key of i18n/source.json needs a non-empty translation that keeps all ⟦n⟧ markers and all HTML tags
(same tags, same attributes) of the English text. Exit code 1 if anything is wrong.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n  # noqa: E402

source = json.loads((i18n.I18N / "source.json").read_text())
bad = False
for code in sys.argv[1:]:
    path = i18n.I18N / f"{code}.json"
    try:
        cat = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"{code}: can't read {path}: {e}")
        bad = True
        continue
    missing = [k for k in source if k not in cat or not str(cat[k]).strip()]
    broken = [k for k in source if k in cat and str(cat[k]).strip() and not i18n.valid(k, cat[k])]
    extra = [k for k in cat if k not in source]
    print(f"{code}: {len(source) - len(missing) - len(broken)}/{len(source)} ok, {len(missing)} missing, "
          f"{len(broken)} with changed markers/tags, {len(extra)} unknown keys")
    for k in (missing + broken)[:15]:
        print("   ", "MISSING" if k in missing else "BROKEN ", repr(k[:100]))
    bad = bad or bool(missing or broken)
sys.exit(1 if bad else 0)
