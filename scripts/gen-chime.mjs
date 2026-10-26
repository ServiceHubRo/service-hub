// T47: the sound of a new booking, written as a WAV file for the web app (public/sounds) and for the
// Android app's notification channel (res/raw). Made here from a few sine tones, so it is ours and
// the same everywhere; run again only to change it:
//
//   node scripts/gen-chime.mjs
//
// Three soft mallet notes rising (G5, C6, E6, a C major arpeggio), each a short pluck that rings
// out, with a faint room echo; about 1.2 s, at -6 dB so it is noticed without startling.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const RATE = 44_100;
const LENGTH = 1.25; // seconds
const NOTES = [
  { at: 0, hz: 783.99, gain: 0.85 }, // G5
  { at: 0.12, hz: 1046.5, gain: 0.75 }, // C6
  { at: 0.24, hz: 1318.51, gain: 0.7 }, // E6
];

const samples = new Float64Array(Math.round(RATE * LENGTH));
for (const note of NOTES) {
  const start = Math.round(note.at * RATE);
  for (let i = start; i < samples.length; i++) {
    const t = (i - start) / RATE;
    const attack = Math.min(1, t / 0.004); // 4 ms, no click
    const ring = Math.exp(-t / 0.32); // the body of the note
    const shine = Math.exp(-t / 0.07); // the brighter overtones fade first
    const tone =
      Math.sin(2 * Math.PI * note.hz * t) +
      0.18 * shine * Math.sin(2 * Math.PI * note.hz * 2 * t) +
      0.06 * shine * Math.sin(2 * Math.PI * note.hz * 3.01 * t);
    samples[i] += note.gain * attack * ring * tone;
  }
}

// A faint room: two quiet echoes.
for (const [delay, gain] of [[0.045, 0.18], [0.11, 0.1]]) {
  const d = Math.round(delay * RATE);
  for (let i = samples.length - 1; i >= d; i--) samples[i] += gain * samples[i - d];
}

// The last 150 ms fade to silence; the loudest point at -6 dB.
const fade = Math.round(0.15 * RATE);
for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const scale = 0.5 / peak;

const data = Buffer.alloc(samples.length * 2);
samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), i * 2));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // bytes per second
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
const wav = Buffer.concat([header, data]);

for (const path of ['public/sounds/new-booking.wav', 'android/app/src/main/res/raw/new_booking.wav']) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, wav);
}
process.stdout.write(`chime: ${LENGTH} s, ${Math.round(wav.length / 1024)} KB, written to public/sounds and android res/raw\n`);
