#!/usr/bin/env python3
"""ゲームの本文の文字（Zen角ゴシック New）を、ゲームで使う字だけに絞って src/img/font/ に作る。

  python3 scripts/font-subset.py      （fonttools と brotli が要る：pip install fonttools brotli）

元の文字ファイルは fonts/（SIL Open Font License・fonts/OFL.txt）。
src/ の .js・.html・.css に出てくる字＋英数字・ひらがな・カタカナ・全角記号だけを残す（1 つ 170KB ほど）。
新しい字（新しいダンジョンの名前など）を足したら、これを実行し直すとその字もこの文字になる。
実行しなくても動く（無い字だけ端末の標準のゴシック体で出る）。
"""
import glob, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
text = ''
for pat in ('src/*.js', 'src/*.html', 'src/*.css'):
    for f in glob.glob(os.path.join(ROOT, pat)):
        text += open(f, encoding='utf-8').read()
chars = set(text)
for lo, hi in ((0x20, 0x7e), (0x3000, 0x30ff), (0xff01, 0xff5e)):
    chars |= {chr(c) for c in range(lo, hi + 1)}

for w in ('400', '700'):
    src = os.path.join(ROOT, 'fonts', f'ZenKakuGothicNew-{w}.woff2')
    dst = os.path.join(ROOT, 'src', 'img', 'font', f'zkg-{w}.woff2')
    font = TTFont(src)
    cmap = font.getBestCmap()
    codes = sorted(ord(c) for c in chars if ord(c) in cmap)
    opt = subset.Options()
    opt.flavor = 'woff2'
    opt.layout_features = ['*']
    opt.notdef_outline = True
    sub = subset.Subsetter(opt)
    sub.populate(unicodes=codes)
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(dst)
    print(f'{os.path.relpath(dst, ROOT)}: {len(codes)} 字・{os.path.getsize(dst) // 1024}KB')
