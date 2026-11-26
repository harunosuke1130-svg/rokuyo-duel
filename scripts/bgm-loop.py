#!/usr/bin/env python3
"""BGM のループ素材を作る（FL Studio などで書き出した WAV → 継ぎ目なしでくり返せる MP3）。

  python3 scripts/bgm-loop.py <入力.wav> <出力.mp3> <BPM> <小節数> [kbps]

- 入力の先頭から「小節数」ぶん（4/4 拍子）を 1 周とし、その後ろに残った余韻（リバーブなど）は
  1 周の頭に重ねる（FL Studio の Wrap remainder と同じ）。これで 1 周の終わりと頭がなめらかにつながる。
- MP3 は頭と終わりにわずかな無音が入るので、1 周を 2 回つなげて保存する。ゲーム側
  （src/ui-sound.js の BGM）は 2 周の途中の 1 周ぶん（loopStart〜loopStart+1周）をくり返すので、
  無音の長さが端末ごとに違っても継ぎ目は出ない。
- 必要なもの：numpy・lameenc（pip install numpy lameenc）
"""
import sys, wave
import numpy as np
import lameenc

src, dst, bpm, bars = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
kbps = int(sys.argv[5]) if len(sys.argv) > 5 else 112
w = wave.open(src)
sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
assert sw == 2, '16bit の WAV にしてください'
d = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float64)
if ch == 1:
    d = np.repeat(d, 2, axis=1)
period = int(round(sr * 60 / bpm * 4 * bars))
assert period <= n, f'WAV が短すぎます（1周 {period} / {n} サンプル）'
loop = d[:period].copy()
tail = d[period:]
while len(tail):                       # 余韻を頭へ重ねる（1周より長くても折り返す）
    k = min(len(tail), period)
    loop[:k] += tail[:k]
    tail = tail[k:]
peak = np.abs(loop).max()
if peak > 32767:
    loop *= 32767 / peak
pcm = np.clip(np.round(np.vstack([loop, loop])), -32768, 32767).astype(np.int16)
enc = lameenc.Encoder()
enc.set_bit_rate(kbps); enc.set_in_sample_rate(sr); enc.set_channels(2); enc.set_quality(2)
mp3 = enc.encode(pcm.tobytes()) + enc.flush()
open(dst, 'wb').write(mp3)
jump = np.abs(loop[0] - loop[-1]).max() / 32768
print(f'1周 {period} サンプル = {period / sr:.6f} 秒（{bpm}BPM・{bars}小節）・継ぎ目の段差 {jump:.4f}・{len(mp3) // 1024}KB → {dst}')
