#!/usr/bin/env python3
"""ダンジョンの絵の保存・軽量化（scripts/dungeon-art.js から呼ぶ）。

  python3 -I scripts/art_process.py <設定JSON>

設定 JSON：
  { "jobs": [ { "kind": "enemy" | "portrait" | "landscape" | "banner",
                "src": 元の画像, "out": 出力先 .webp,
                "focus": [x, y]（0〜1。切り抜くときの中心。省略時は中央）} ... ] }

- まわりの無地の余白・枠（ほぼ同じ色の行と列）を自動で切り落とす（各辺 12% まで）
- enemy（敵）：縦長（幅:高さ ≒ 0.45〜0.62）にそろえ、幅 360px・80KB 以下
- portrait（スマホの背景）：620×1102（9:16）に余白なしで切り抜き・200KB 以下
- landscape（PC の背景）：1100×619（16:9）・200KB 以下
- cutout（背景を透明にした敵）：透明のまま。透明が無い絵は、まわりの平らな地の色を外側から塗りつぶして抜く。
  中身の大きさに切り詰め、幅 360px 以内・80KB 以下（戦闘で背景の中に立たせる。src/img/boss）
- enemycut（背景なしの絵から作る紋章・図鑑用の敵の絵）：cutout と同じく抜いてから、透明のまま縦長（幅:高さ 0.56）の
  箱に下ぞろえで置き、幅 360px・80KB 以下（src/img/chara。背景ありの絵 floorN が無いときに使う）
- banner（ダンジョン一覧のカード）：横長の背景から 2:1 で切り抜き、640×320・60KB 以下（スマホのカードは約 2.1:1、PC は約 1.6:1 で、どちらも余白なしで覆う）
結果（大きさ・容量・画質）を JSON で標準出力に出す。
"""
import io
import json
import statistics
import sys

from PIL import Image

SPECS = {
    'enemy':     {'max_kb': 80,  'width': 360},
    'portrait':  {'max_kb': 200, 'size': (620, 1102)},
    'landscape': {'max_kb': 200, 'size': (1100, 619)},
    'banner':    {'max_kb': 60,  'size': (640, 320)},
    'cutout':    {'max_kb': 80,  'width': 360},
    'enemycut':  {'max_kb': 80,  'width': 360},
}
ENEMY_RATIO = (0.45, 0.62)   # 幅÷高さ（既存の敵の絵は約 0.53）


def flatten(im):
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (239, 230, 210))   # 透過は羊皮紙色の地に
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert('RGB')


def trim(im, limit=0.12, tol=10):
    """まわりの無地の帯（同じ色がほぼ続く行・列）を切り落とす。"""
    w, h = im.size
    small = im.resize((max(1, w // 4), max(1, h // 4)))
    sw, sh = small.size
    px = small.load()

    def flat(cells):
        return max(statistics.pstdev(c[i] for c in cells) for i in range(3)) < tol

    def row(y): return [px[x, y] for x in range(sw)]
    def col(x): return [px[x, y] for y in range(sh)]
    top = 0
    while top < sh * limit and flat(row(top)): top += 1
    bottom = sh - 1
    while sh - 1 - bottom < sh * limit and flat(row(bottom)): bottom -= 1
    left = 0
    while left < sw * limit and flat(col(left)): left += 1
    right = sw - 1
    while sw - 1 - right < sw * limit and flat(col(right)): right -= 1
    box = (left * 4, top * 4, min(w, (right + 1) * 4), min(h, (bottom + 1) * 4))
    return im.crop(box) if box != (0, 0, w, h) else im


def cover(im, size, focus):
    """余白なしで size を覆うように拡大・切り抜く（focus を中心に）。"""
    tw, th = size
    w, h = im.size
    scale = max(tw / w, th / h)
    nw, nh = max(tw, round(w * scale)), max(th, round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    fx, fy = focus
    x = min(max(0, round(nw * fx - tw / 2)), nw - tw)
    y = min(max(0, round(nh * fy - th / 2)), nh - th)
    return im.crop((x, y, x + tw, y + th))


def enemy(im, focus):
    w, h = im.size
    r = w / h
    lo, hi = ENEMY_RATIO
    if r > hi:      # 横に広すぎる：左右を切る
        nw = round(h * 0.56)
        x = min(max(0, round(w * focus[0] - nw / 2)), w - nw)
        im = im.crop((x, 0, x + nw, h))
    elif r < lo:    # 縦に長すぎる：上下を切る
        nh = round(w / 0.53)
        y = min(max(0, round(h * focus[1] - nh / 2)), h - nh)
        im = im.crop((0, y, w, y + nh))
    w, h = im.size
    tw = SPECS['enemy']['width']
    return im.resize((tw, round(h * tw / w)), Image.LANCZOS)


def save_small(im, out, max_kb):
    """容量の上限に入るまで画質を下げて WebP で保存する。"""
    for q in range(88, 39, -4):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= max_kb * 1024 or q <= 40:
            with open(out, 'wb') as f:
                f.write(buf.getvalue())
            return q, buf.tell()


def cutout(src):
    """背景を透明にした敵の絵：透明が無ければ、外側から平らな地の色を抜く。中身の大きさに切り詰めて縮める。"""
    from PIL import ImageDraw, ImageFilter
    im = Image.open(src).convert('RGBA')
    a = im.getchannel('A')
    if a.getextrema()[0] > 250:   # 透明が無い：四隅の色を地の色として、外側からつながっている所を抜く
        rgb = im.convert('RGB')
        w, h = rgb.size
        mask = Image.new('L', (w + 2, h + 2), 0)
        pad = Image.new('RGB', (w + 2, h + 2), rgb.getpixel((0, 0)))
        pad.paste(rgb, (1, 1))
        ImageDraw.floodfill(pad, (0, 0), (255, 0, 255), thresh=34)
        px = pad.load()
        m = Image.new('L', (w, h), 255)
        mp = m.load()
        for y in range(h):
            for x in range(w):
                if px[x + 1, y + 1] == (255, 0, 255):
                    mp[x, y] = 0
        m = m.filter(ImageFilter.GaussianBlur(1.2))
        im.putalpha(m)
    a = im.getchannel('A').point(lambda v: 0 if v < 24 else v)
    im.putalpha(a)
    box = a.getbbox()
    if box:
        x0, y0, x1, y1 = box
        p = 8
        im = im.crop((max(0, x0 - p), max(0, y0 - p), min(im.width, x1 + p), min(im.height, y1 + p)))
    tw = SPECS['cutout']['width']
    if im.width > tw:
        im = im.resize((tw, round(im.height * tw / im.width)), Image.LANCZOS)
    if im.height > 700:
        im = im.resize((round(im.width * 700 / im.height), 700), Image.LANCZOS)
    return im


def enemy_from_cut(src):
    """背景なしの絵を、透明のまま縦長の箱（幅:高さ 0.56）に下ぞろえで置く。"""
    im = cutout(src)
    w, h = im.size
    W = max(w, round(h * 0.56))
    H = max(h, round(W / 0.56))
    box = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    box.paste(im, ((W - w) // 2, H - h), im)
    tw = SPECS['enemycut']['width']
    return box.resize((tw, round(H * tw / W)), Image.LANCZOS)


def run(job):
    kind = job['kind']
    spec = SPECS[kind]
    if kind == 'enemycut':
        im = enemy_from_cut(job['src'])
        q, size = save_small(im, job['out'], spec['max_kb'])
        return {'kind': kind, 'src': job['src'], 'out': job['out'], 'trimmed': list(im.size), 'size': list(im.size),
                'kb': round(size / 1024, 1), 'quality': q, 'ok': size <= spec['max_kb'] * 1024}
    if kind == 'cutout':
        im = cutout(job['src'])
        q, size = save_small(im, job['out'], spec['max_kb'])
        return {'kind': kind, 'src': job['src'], 'out': job['out'], 'trimmed': list(im.size), 'size': list(im.size),
                'kb': round(size / 1024, 1), 'quality': q, 'ok': size <= spec['max_kb'] * 1024}
    focus = tuple(job.get('focus') or (0.5, 0.5))
    im = trim(flatten(Image.open(job['src'])))
    src_size = im.size
    if kind == 'enemy':
        im = enemy(im, focus)
    else:
        im = cover(im, spec['size'], focus)
    q, size = save_small(im, job['out'], spec['max_kb'])
    return {'kind': kind, 'src': job['src'], 'out': job['out'], 'trimmed': list(src_size), 'size': list(im.size),
            'kb': round(size / 1024, 1), 'quality': q, 'ok': size <= spec['max_kb'] * 1024}


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    print(json.dumps([run(j) for j in cfg['jobs']], ensure_ascii=False))


if __name__ == '__main__':
    main()
