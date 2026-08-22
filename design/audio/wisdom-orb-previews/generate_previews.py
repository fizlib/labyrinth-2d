"""Generate original Wisdom Orb sound-design previews.

These are intentionally lightweight mockups for choosing a direction.  They use
only synthesized tones and noise, so they can be regenerated without external
sample or licensing dependencies.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter


SAMPLE_RATE = 48_000
OUTPUT_DIR = Path(__file__).resolve().parent
RNG = np.random.default_rng(0x0B5E55ED)


def timeline(duration: float) -> np.ndarray:
    return np.arange(round(duration * SAMPLE_RATE), dtype=np.float64) / SAMPLE_RATE


def pan(mono: np.ndarray, position: float = 0.0) -> np.ndarray:
    """Constant-power pan, where -1 is left and +1 is right."""
    position = float(np.clip(position, -1.0, 1.0))
    angle = (position + 1.0) * np.pi / 4.0
    return np.column_stack((mono * np.cos(angle), mono * np.sin(angle)))


def add(target: np.ndarray, sound: np.ndarray, start: float = 0.0) -> None:
    index = round(start * SAMPLE_RATE)
    if sound.ndim == 1:
        sound = pan(sound)
    end = min(index + len(sound), len(target))
    if end > index:
        target[index:end] += sound[: end - index]


def tone(
    duration: float,
    frequency: float,
    *,
    attack: float = 0.008,
    decay: float = 0.35,
    gain: float = 1.0,
    vibrato_hz: float = 0.0,
    vibrato_depth: float = 0.0,
) -> np.ndarray:
    t = timeline(duration)
    vibrato = vibrato_depth * np.sin(2.0 * np.pi * vibrato_hz * t)
    phase = 2.0 * np.pi * frequency * t + vibrato
    envelope = np.minimum(t / max(attack, 1e-5), 1.0) * np.exp(-t / decay)
    return gain * envelope * np.sin(phase)


def chirp_tone(
    duration: float,
    start_hz: float,
    end_hz: float,
    *,
    decay: float,
    gain: float,
) -> np.ndarray:
    t = timeline(duration)
    progress = np.clip(t / duration, 0.0, 1.0)
    frequency = start_hz * np.power(end_hz / start_hz, progress)
    phase = 2.0 * np.pi * np.cumsum(frequency) / SAMPLE_RATE
    envelope = np.sin(np.pi * np.minimum(t / 0.018, 0.5)) * np.exp(-t / decay)
    return gain * envelope * np.sin(phase)


def bell(duration: float, frequency: float, *, gain: float = 1.0) -> np.ndarray:
    t = timeline(duration)
    partials = (
        (1.00, 1.000, 0.48),
        (0.44, 2.006, 0.32),
        (0.20, 2.996, 0.22),
        (0.13, 4.112, 0.16),
        (0.08, 5.431, 0.12),
    )
    signal = np.zeros_like(t)
    for amplitude, ratio, decay in partials:
        signal += amplitude * np.exp(-t / decay) * np.sin(
            2.0 * np.pi * frequency * ratio * t + ratio * 0.17
        )
    attack = np.minimum(t / 0.004, 1.0)
    return gain * attack * signal


def filtered_noise(
    duration: float,
    *,
    low_hz: float,
    high_hz: float,
    gain: float = 1.0,
    reverse: bool = False,
) -> np.ndarray:
    count = round(duration * SAMPLE_RATE)
    noise = RNG.standard_normal(count)
    nyquist = SAMPLE_RATE / 2.0
    if low_hz <= 0:
        b, a = butter(3, high_hz / nyquist, btype="lowpass")
    else:
        b, a = butter(3, [low_hz / nyquist, high_hz / nyquist], btype="bandpass")
    noise = lfilter(b, a, noise)
    progress = np.linspace(0.0, 1.0, count, endpoint=False)
    envelope = np.sin(np.pi * progress) ** 1.4
    if reverse:
        envelope *= progress**1.4
    else:
        envelope *= (1.0 - progress) ** 0.45
    return gain * envelope * noise


def sparkle(duration: float, *, density: int, low_hz: float, high_hz: float) -> np.ndarray:
    result = np.zeros((round(duration * SAMPLE_RATE), 2), dtype=np.float64)
    for _ in range(density):
        start = RNG.uniform(0.0, max(0.01, duration - 0.08))
        frequency = RNG.uniform(low_hz, high_hz)
        ping = bell(RNG.uniform(0.07, 0.18), frequency, gain=RNG.uniform(0.015, 0.045))
        add(result, pan(ping, RNG.uniform(-0.8, 0.8)), start)
    return result


def echoes(stereo: np.ndarray, taps: tuple[tuple[float, float, float], ...]) -> np.ndarray:
    """Add short cross-channel echoes: (delay seconds, gain, stereo spread)."""
    result = stereo.copy()
    for delay, gain, spread in taps:
        samples = round(delay * SAMPLE_RATE)
        if samples >= len(stereo):
            continue
        echoed = stereo[:-samples, ::-1] if spread < 0 else stereo[:-samples]
        result[samples:] += echoed * gain
    return result


def soften(stereo: np.ndarray, cutoff_hz: float = 13_000.0) -> np.ndarray:
    b, a = butter(2, cutoff_hz / (SAMPLE_RATE / 2.0), btype="lowpass")
    return np.column_stack((lfilter(b, a, stereo[:, 0]), lfilter(b, a, stereo[:, 1])))


def finish(name: str, stereo: np.ndarray) -> None:
    stereo = soften(stereo)
    stereo = echoes(stereo, ((0.071, 0.18, 1), (0.127, 0.11, -1), (0.193, 0.06, 1)))
    fade = min(round(0.025 * SAMPLE_RATE), len(stereo) // 2)
    stereo[:fade] *= np.linspace(0.0, 1.0, fade)[:, None]
    stereo[-fade:] *= np.linspace(1.0, 0.0, fade)[:, None]
    peak = np.max(np.abs(stereo))
    if peak > 0:
        stereo *= 0.88 / peak
    pcm = np.asarray(np.clip(stereo, -1.0, 1.0) * 32767.0, dtype=np.int16)
    wavfile.write(OUTPUT_DIR / name, SAMPLE_RATE, pcm)


def finish_soft(name: str, stereo: np.ndarray) -> None:
    """Master the quieter, rounder second-pass concepts."""
    stereo = soften(stereo, cutoff_hz=9_500.0)
    stereo = echoes(
        stereo,
        (
            (0.089, 0.15, 1),
            (0.157, 0.10, -1),
            (0.241, 0.07, 1),
            (0.337, 0.04, -1),
        ),
    )
    fade_in = min(round(0.055 * SAMPLE_RATE), len(stereo) // 2)
    fade_out = min(round(0.12 * SAMPLE_RATE), len(stereo) // 2)
    stereo[:fade_in] *= np.linspace(0.0, 1.0, fade_in)[:, None]
    stereo[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)[:, None]
    peak = np.max(np.abs(stereo))
    if peak > 0:
        stereo *= 0.62 / peak
    pcm = np.asarray(np.clip(stereo, -1.0, 1.0) * 32767.0, dtype=np.int16)
    wavfile.write(OUTPUT_DIR / name, SAMPLE_RATE, pcm)


def soft_bell(duration: float, frequency: float, *, gain: float = 1.0) -> np.ndarray:
    """A glassy tone without the hard metallic transient of ``bell``."""
    t = timeline(duration)
    envelope = np.minimum(t / 0.065, 1.0) * np.exp(-t / 0.62)
    signal = (
        np.sin(2.0 * np.pi * frequency * t)
        + 0.19 * np.sin(2.0 * np.pi * frequency * 2.003 * t + 0.3)
        + 0.07 * np.sin(2.0 * np.pi * frequency * 3.997 * t + 0.8)
    )
    return gain * envelope * signal


def warm_pad(duration: float, frequencies: tuple[float, ...], *, gain: float) -> np.ndarray:
    t = timeline(duration)
    envelope = np.sin(np.pi * np.clip(t / duration, 0.0, 1.0)) ** 0.8
    signal = np.zeros_like(t)
    for index, frequency in enumerate(frequencies):
        drift = 0.035 * np.sin(2.0 * np.pi * (0.23 + index * 0.07) * t)
        signal += np.sin(2.0 * np.pi * frequency * t + drift) / len(frequencies)
    return gain * envelope * signal


def insight_chime() -> np.ndarray:
    sound = np.zeros((round(1.10 * SAMPLE_RATE), 2))
    add(sound, pan(filtered_noise(0.25, low_hz=900, high_hz=6_500, gain=0.12, reverse=True), -0.1), 0.00)
    add(sound, pan(bell(0.76, 880.00, gain=0.29), -0.18), 0.15)
    add(sound, pan(bell(0.70, 1174.66, gain=0.24), 0.18), 0.27)
    add(sound, sparkle(0.72, density=10, low_hz=1_600, high_hz=3_300), 0.21)
    return sound


def consume_reveal() -> np.ndarray:
    sound = np.zeros((round(1.18 * SAMPLE_RATE), 2))
    add(sound, pan(filtered_noise(0.16, low_hz=120, high_hz=1_800, gain=0.26), 0.0), 0.00)
    add(sound, pan(chirp_tone(0.24, 430, 125, decay=0.11, gain=0.27), 0.0), 0.00)
    add(sound, pan(filtered_noise(0.24, low_hz=1_100, high_hz=8_500, gain=0.13, reverse=True), 0.0), 0.13)
    add(sound, pan(bell(0.78, 783.99, gain=0.30), -0.12), 0.28)
    add(sound, pan(bell(0.66, 1174.66, gain=0.20), 0.16), 0.42)
    add(sound, sparkle(0.66, density=8, low_hz=1_700, high_hz=3_600), 0.32)
    return sound


def arcane_whisper() -> np.ndarray:
    sound = np.zeros((round(1.52 * SAMPLE_RATE), 2))
    swell = filtered_noise(0.67, low_hz=350, high_hz=4_200, gain=0.15, reverse=True)
    add(sound, pan(swell, -0.22), 0.00)
    add(sound, pan(swell[::-1] * 0.55, 0.22), 0.43)
    for frequency, position, gain in ((349.23, -0.25, 0.10), (440.00, 0.0, 0.09), (523.25, 0.25, 0.08)):
        whisper = tone(0.94, frequency, attack=0.22, decay=0.68, gain=gain, vibrato_hz=5.2, vibrato_depth=0.09)
        add(sound, pan(whisper, position), 0.23)
    add(sound, pan(bell(0.62, 1396.91, gain=0.11), 0.25), 0.58)
    add(sound, sparkle(0.72, density=7, low_hz=1_400, high_hz=2_900), 0.54)
    return sound


def compass_pulse() -> np.ndarray:
    sound = np.zeros((round(1.12 * SAMPLE_RATE), 2))
    add(sound, pan(chirp_tone(0.33, 180, 360, decay=0.18, gain=0.33), 0.0), 0.00)
    add(sound, pan(bell(0.58, 659.25, gain=0.18), -0.45), 0.16)
    add(sound, pan(bell(0.55, 880.00, gain=0.17), 0.00), 0.28)
    add(sound, pan(bell(0.50, 1318.51, gain=0.15), 0.48), 0.40)
    sweep = filtered_noise(0.43, low_hz=1_600, high_hz=7_800, gain=0.08, reverse=True)
    count = len(sweep)
    moving = np.zeros((count, 2))
    positions = np.linspace(-0.82, 0.82, count)
    moving[:, 0] = sweep * np.cos((positions + 1.0) * np.pi / 4.0)
    moving[:, 1] = sweep * np.sin((positions + 1.0) * np.pi / 4.0)
    add(sound, moving, 0.19)
    return sound


def ancient_rune() -> np.ndarray:
    sound = np.zeros((round(1.62 * SAMPLE_RATE), 2))
    add(sound, pan(bell(1.35, 110.00, gain=0.32), 0.0), 0.00)
    add(sound, pan(tone(1.20, 164.81, attack=0.02, decay=0.70, gain=0.14), -0.12), 0.03)
    for start, position in ((0.18, -0.45), (0.31, 0.40), (0.44, -0.10)):
        click = filtered_noise(0.045, low_hz=1_200, high_hz=7_000, gain=0.07)
        add(sound, pan(click, position), start)
    add(sound, pan(filtered_noise(0.36, low_hz=450, high_hz=4_800, gain=0.09, reverse=True), 0.0), 0.34)
    add(sound, pan(bell(0.78, 1046.50, gain=0.22), 0.12), 0.60)
    add(sound, sparkle(0.70, density=6, low_hz=1_250, high_hz=2_500), 0.56)
    return sound


def pixel_fantasy() -> np.ndarray:
    sound = np.zeros((round(0.78 * SAMPLE_RATE), 2))
    for start, frequency, position in (
        (0.00, 523.25, -0.20),
        (0.09, 659.25, 0.00),
        (0.18, 783.99, 0.20),
        (0.29, 1046.50, 0.00),
    ):
        t = timeline(0.26)
        phase = 2.0 * np.pi * frequency * t
        square = np.sign(np.sin(phase))
        triangle = 2.0 * np.abs(2.0 * ((frequency * t) % 1.0) - 1.0) - 1.0
        envelope = np.minimum(t / 0.004, 1.0) * np.exp(-t / 0.095)
        note = (0.075 * square + 0.15 * triangle) * envelope
        add(sound, pan(note, position), start)
    add(sound, pan(filtered_noise(0.09, low_hz=3_000, high_hz=10_000, gain=0.035), 0.0), 0.28)
    add(sound, pan(bell(0.34, 1567.98, gain=0.08), 0.0), 0.29)
    return sound


def starlight_bloom() -> np.ndarray:
    sound = np.zeros((round(1.58 * SAMPLE_RATE), 2))
    add(sound, pan(warm_pad(1.34, (293.66, 440.00, 587.33), gain=0.11), 0.0), 0.08)
    air = filtered_noise(0.46, low_hz=1_100, high_hz=5_200, gain=0.035, reverse=True)
    add(sound, pan(air, -0.08), 0.00)
    add(sound, pan(soft_bell(1.10, 880.00, gain=0.12), -0.16), 0.24)
    add(sound, pan(soft_bell(0.92, 1174.66, gain=0.09), 0.18), 0.46)
    add(sound, sparkle(0.82, density=4, low_hz=1_500, high_hz=2_500) * 0.45, 0.44)
    return sound


def moonlit_whisper() -> np.ndarray:
    sound = np.zeros((round(1.82 * SAMPLE_RATE), 2))
    add(sound, pan(warm_pad(1.56, (261.63, 392.00, 523.25), gain=0.105), -0.06), 0.10)
    air = filtered_noise(0.78, low_hz=500, high_hz=3_800, gain=0.026, reverse=True)
    add(sound, pan(air, -0.30), 0.00)
    add(sound, pan(air[::-1] * 0.42, 0.30), 0.70)
    add(sound, pan(soft_bell(1.16, 783.99, gain=0.095), 0.12), 0.37)
    add(sound, pan(soft_bell(0.86, 1318.51, gain=0.045), -0.10), 0.68)
    return sound


def gentle_guidance() -> np.ndarray:
    sound = np.zeros((round(1.46 * SAMPLE_RATE), 2))
    add(sound, pan(warm_pad(1.22, (329.63, 493.88, 659.25), gain=0.09), 0.0), 0.10)
    add(sound, pan(soft_bell(0.90, 659.25, gain=0.11), -0.12), 0.20)
    add(sound, pan(soft_bell(0.78, 987.77, gain=0.07), 0.12), 0.42)
    add(sound, pan(filtered_noise(0.36, low_hz=1_300, high_hz=5_500, gain=0.025, reverse=True), 0.0), 0.08)
    add(sound, sparkle(0.66, density=3, low_hz=1_350, high_hz=2_100) * 0.34, 0.48)
    return sound


def faerie_breath() -> np.ndarray:
    sound = np.zeros((round(1.70 * SAMPLE_RATE), 2))
    left_air = filtered_noise(0.88, low_hz=700, high_hz=4_500, gain=0.03, reverse=True)
    right_air = filtered_noise(0.96, low_hz=900, high_hz=5_100, gain=0.025, reverse=True)
    add(sound, pan(left_air, -0.42), 0.00)
    add(sound, pan(right_air, 0.38), 0.14)
    add(sound, pan(warm_pad(1.30, (349.23, 523.25, 698.46), gain=0.075), 0.0), 0.20)
    add(sound, pan(chirp_tone(0.84, 620, 920, decay=0.54, gain=0.055), -0.12), 0.31)
    add(sound, pan(soft_bell(0.82, 1396.91, gain=0.04), 0.18), 0.63)
    return sound


def main() -> None:
    previews = {
        "01-insight-chime.wav": insight_chime(),
        "02-consume-reveal.wav": consume_reveal(),
        "03-arcane-whisper.wav": arcane_whisper(),
        "04-compass-pulse.wav": compass_pulse(),
        "05-ancient-rune.wav": ancient_rune(),
        "06-pixel-fantasy.wav": pixel_fantasy(),
    }
    for filename, audio in previews.items():
        finish(filename, audio)
        print(filename)

    soft_previews = {
        "07-starlight-bloom.wav": starlight_bloom(),
        "08-moonlit-whisper.wav": moonlit_whisper(),
        "09-gentle-guidance.wav": gentle_guidance(),
        "10-faerie-breath.wav": faerie_breath(),
    }
    for filename, audio in soft_previews.items():
        finish_soft(filename, audio)
        print(filename)


if __name__ == "__main__":
    main()
