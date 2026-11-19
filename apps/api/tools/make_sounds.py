"""Generates the starter sound library: short original loops synthesised from scratch (no samples, no copyright).
Run: python3 tools/make_sounds.py   (needs numpy and ffmpeg). Output goes to assets/sounds/."""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np

SR = 44100
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'sounds'
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(7)

def note(f):  # semitones from A4
    return 440.0 * 2 ** (f / 12)

def env(n, a=0.01, d=0.2, s=0.6, r=0.2):
    e = np.ones(n)
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    e[:a_n] = np.linspace(0, 1, a_n, endpoint=False)
    e[a_n:a_n + d_n] = np.linspace(1, s, d_n)
    e[a_n + d_n:n - r_n] = s
    e[n - r_n:] = np.linspace(s, 0, r_n)
    return e

def tone(freq, dur, wave='sine', **kw):
    n = int(dur * SR); t = np.arange(n) / SR
    if wave == 'sine': y = np.sin(2 * np.pi * freq * t)
    elif wave == 'tri': y = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * freq * t))
    elif wave == 'saw': y = 2 * ((freq * t) % 1) - 1
    elif wave == 'pluck': y = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(4 * np.pi * freq * t) * np.exp(-t * 6)
    else: y = np.sin(2 * np.pi * freq * t)
    return y * env(n, **kw)

def kick(dur=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 18) + 40
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def hat(dur=0.06):
    n = int(dur * SR); return rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 70) * 0.5

def snare(dur=0.2):
    n = int(dur * SR); t = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 20)

def place(buf, sound, at):
    i = int(at * SR); j = min(len(buf), i + len(sound))
    if i < len(buf): buf[i:j] += sound[:j - i]

def finish(buf, name, fade=0.05):
    buf = np.tanh(buf * 0.9)
    f = int(fade * SR); buf[:f] *= np.linspace(0, 1, f); buf[-f:] *= np.linspace(1, 0, f)
    pcm = (buf / max(1e-9, np.abs(buf).max()) * 0.85 * 32767).astype('<i2')
    wav = OUT / f'{name}.wav'
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    mp3 = OUT / f'{name}.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '96k', str(mp3)], check=True)
    wav.unlink()

def grid(bpm, bars=4):
    beat = 60 / bpm; return beat, bars * 4 * beat

tracks = []
def add(name, title, bpm, mood, color, buf_fn):
    beat, total = grid(bpm)
    buf = np.zeros(int(total * SR))
    buf_fn(buf, beat)
    finish(buf, name)
    tracks.append({'file': f'{name}.mp3', 'title': title, 'artist': 'BMUETTE Originals', 'mood': mood, 'bpm': bpm, 'durationMs': int(total * 1000), 'color': color})

def golden(buf, b):
    chords = [(-12, -8, -5), (-10, -7, -3), (-14, -10, -7), (-12, -8, -5)]
    for bar, ch in enumerate(chords):
        for f in ch: place(buf, tone(note(f), 4 * b, 'tri', a=0.4, d=0.5, s=0.7, r=0.6) * 0.35, bar * 4 * b)
        for k in range(8): place(buf, tone(note(ch[k % 3] + 12), b, 'pluck', a=0.005, d=0.3, s=0.2, r=0.3) * 0.25, bar * 4 * b + k * b / 2)
def lagos(buf, b):
    for bar in range(4):
        for k in (0, 1.5, 2.5): place(buf, kick() * 0.9, (bar * 4 + k) * b)
        for k in (1, 3): place(buf, snare() * 0.5, (bar * 4 + k) * b)
        for k in range(16): place(buf, hat() * (0.6 if k % 2 else 0.35), (bar * 4 + k / 4) * b)
        for k, f in zip((0, 0.75, 1.5, 2.5, 3.25), (-24, -24, -21, -19, -21)): place(buf, tone(note(f), b * 0.6, 'saw', a=0.005, d=0.1, s=0.5, r=0.1) * 0.35, (bar * 4 + k) * b)
        for k, f in zip((0.5, 1.25, 2, 3), (0, 3, 7, 5)): place(buf, tone(note(f), b * 0.4, 'pluck') * 0.2, (bar * 4 + k) * b)
def soft(buf, b):
    prog = [(-9, -5, 0), (-7, -4, 2), (-12, -8, -5), (-5, -1, 4)]
    for bar, ch in enumerate(prog):
        for i, f in enumerate(ch * 2): place(buf, tone(note(f + 12), b * 1.4, 'sine', a=0.01, d=0.4, s=0.3, r=0.6) * 0.3, bar * 4 * b + i * b * 0.66)
        place(buf, tone(note(ch[0] - 12), 4 * b, 'sine', a=0.1, d=0.3, s=0.8, r=0.5) * 0.4, bar * 4 * b)
def street(buf, b):
    for bar in range(4):
        for k in range(4): place(buf, kick() * 0.95, (bar * 4 + k) * b)
        for k in (1, 3): place(buf, snare() * 0.55, (bar * 4 + k) * b)
        for k in range(8): place(buf, hat() * 0.5, (bar * 4 + k * 0.5 + 0.25) * b)
        for k, f in enumerate((-24, -24, -17, -19)): place(buf, tone(note(f), b * 0.9, 'saw', a=0.01, d=0.2, s=0.5, r=0.1) * 0.35, (bar * 4 + k) * b)
def sunday(buf, b):
    scale = [0, 2, 4, 7, 9, 12, 14, 16]
    seq = [0, 2, 4, 2, 5, 4, 2, 1] * 8
    for i, s in enumerate(seq[:32]): place(buf, tone(note(scale[s] + 3), b * 1.5, 'sine', a=0.003, d=0.5, s=0.1, r=0.8) * 0.35, i * b * 0.5)
    for bar, f in enumerate((-9, -7, -5, -7)): place(buf, tone(note(f - 12), 4 * b, 'tri', a=0.2, d=0.4, s=0.7, r=0.6) * 0.35, bar * 4 * b)
def neon(buf, b):
    arp = [0, 3, 7, 12, 7, 3]
    for bar, root in enumerate((-12, -9, -7, -10)):
        for k in range(16): place(buf, tone(note(root + arp[k % 6] + 12), b * 0.3, 'saw', a=0.003, d=0.1, s=0.4, r=0.08) * 0.22, (bar * 4 + k / 4) * b)
        place(buf, tone(note(root - 12), 4 * b, 'saw', a=0.02, d=0.3, s=0.6, r=0.3) * 0.25, bar * 4 * b)
        for k in (0, 2): place(buf, kick() * 0.7, (bar * 4 + k) * b)
        place(buf, snare() * 0.35, (bar * 4 + 1) * b); place(buf, snare() * 0.35, (bar * 4 + 3) * b)

add('golden-hour', 'Golden Hour', 92, 'Warm', '#E7B66B', golden)
add('lagos-nights', 'Lagos Nights', 102, 'Groove', '#7BC8A4', lagos)
add('soft-launch', 'Soft Launch', 80, 'Calm', '#9DB8E6', soft)
add('street-pulse', 'Street Pulse', 118, 'Energy', '#E6735C', street)
add('sunday-slow', 'Sunday Slow', 76, 'Chill', '#C7A6E8', sunday)
add('neon-drive', 'Neon Drive', 110, 'Night', '#5CC6E6', neon)

(OUT / 'manifest.json').write_text(json.dumps(tracks, indent=2))
print('wrote', len(tracks), 'tracks to', OUT)
