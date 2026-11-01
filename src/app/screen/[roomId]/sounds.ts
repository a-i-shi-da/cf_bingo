// 投影画面の効果音（screens.md 7章）。音のファイルは読み込まず、Web Audio で作る（通信量を増やさない）

export class Sounds {
  private ctx: AudioContext;

  /** ブラウザの決まりで、クリックなどの操作のあとに作る */
  constructor() {
    this.ctx = new AudioContext();
  }

  private tone(freq: number, start: number, duration: number, type: OscillatorType = "triangle", volume = 0.25) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }

  private noise(start: number, duration: number, volume: number) {
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain).connect(this.ctx.destination);
    src.start(start);
  }

  /** ドラムロール（seconds 秒）→ 番号が決まった音 */
  drumroll(seconds: number) {
    const t0 = this.ctx.currentTime;
    for (let t = 0; t < seconds; t += 0.05) this.noise(t0 + t, 0.05, 0.08 + (t / seconds) * 0.15);
    this.tone(523, t0 + seconds, 0.6, "square", 0.2);
    this.tone(784, t0 + seconds, 0.6, "square", 0.15);
  }

  /** ビンゴが出たときのファンファーレ */
  fanfare() {
    const t0 = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => this.tone(f, t0 + i * 0.15, i === notes.length - 1 ? 1.2 : 0.3, "square", 0.2));
  }
}
