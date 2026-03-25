type AmbientType = "rain" | "forest" | "ocean" | "space";

let audioCtx: AudioContext | null = null;
let activeNodes: AudioNode[] = [];
let gainNode: GainNode | null = null;

function getContext(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function createNoise(ctx: AudioContext, duration = 2): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return buffer;
}

function createRain(ctx: AudioContext, master: GainNode): AudioNode[] {
  const nodes: AudioNode[] = [];

  const noise = ctx.createBufferSource();
  noise.buffer = createNoise(ctx, 4);
  noise.loop = true;

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 800;
  lpf.Q.value = 0.7;

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 200;
  hpf.Q.value = 0.5;

  const gain1 = ctx.createGain();
  gain1.gain.value = 0.6;

  noise.connect(lpf).connect(hpf).connect(gain1).connect(master);
  noise.start();
  nodes.push(noise);

  const drips = ctx.createBufferSource();
  drips.buffer = createNoise(ctx, 3);
  drips.loop = true;
  const bpf = ctx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.value = 3000;
  bpf.Q.value = 2;
  const dripGain = ctx.createGain();
  dripGain.gain.value = 0.15;
  drips.connect(bpf).connect(dripGain).connect(master);
  drips.start();
  nodes.push(drips);

  return nodes;
}

function createForest(ctx: AudioContext, master: GainNode): AudioNode[] {
  const nodes: AudioNode[] = [];

  const wind = ctx.createBufferSource();
  wind.buffer = createNoise(ctx, 4);
  wind.loop = true;
  const windLpf = ctx.createBiquadFilter();
  windLpf.type = "lowpass";
  windLpf.frequency.value = 400;
  windLpf.Q.value = 0.3;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.3;
  wind.connect(windLpf).connect(windGain).connect(master);
  wind.start();
  nodes.push(wind);

  const rustle = ctx.createBufferSource();
  rustle.buffer = createNoise(ctx, 2);
  rustle.loop = true;
  const rustleBpf = ctx.createBiquadFilter();
  rustleBpf.type = "bandpass";
  rustleBpf.frequency.value = 2500;
  rustleBpf.Q.value = 1.5;
  const rustleGain = ctx.createGain();
  rustleGain.gain.value = 0.12;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.3;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.08;
  lfo.connect(lfoGain);
  lfoGain.connect(rustleGain.gain);
  lfo.start();
  rustle.connect(rustleBpf).connect(rustleGain).connect(master);
  rustle.start();
  nodes.push(rustle, lfo);

  for (let i = 0; i < 3; i++) {
    const bird = ctx.createOscillator();
    bird.type = "sine";
    bird.frequency.value = 1800 + i * 400;
    const birdGain = ctx.createGain();
    birdGain.gain.value = 0;
    const birdLfo = ctx.createOscillator();
    birdLfo.type = "sine";
    birdLfo.frequency.value = 0.15 + i * 0.08;
    const birdLfoGain = ctx.createGain();
    birdLfoGain.gain.value = 0.03;
    birdLfo.connect(birdLfoGain);
    birdLfoGain.connect(birdGain.gain);
    birdLfo.start();
    bird.connect(birdGain).connect(master);
    bird.start();
    nodes.push(bird, birdLfo);
  }

  return nodes;
}

function createOcean(ctx: AudioContext, master: GainNode): AudioNode[] {
  const nodes: AudioNode[] = [];

  const noise = ctx.createBufferSource();
  noise.buffer = createNoise(ctx, 6);
  noise.loop = true;

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 600;
  lpf.Q.value = 0.5;

  const baseGain = ctx.createGain();
  baseGain.gain.value = 0.4;
  noise.connect(lpf).connect(baseGain).connect(master);
  noise.start();
  nodes.push(noise);

  const wave = ctx.createBufferSource();
  wave.buffer = createNoise(ctx, 5);
  wave.loop = true;
  const waveLpf = ctx.createBiquadFilter();
  waveLpf.type = "lowpass";
  waveLpf.frequency.value = 300;
  const waveGain = ctx.createGain();
  waveGain.gain.value = 0;
  const waveLfo = ctx.createOscillator();
  waveLfo.type = "sine";
  waveLfo.frequency.value = 0.08;
  const waveLfoGain = ctx.createGain();
  waveLfoGain.gain.value = 0.35;
  waveLfo.connect(waveLfoGain);
  waveLfoGain.connect(waveGain.gain);
  waveLfo.start();
  wave.connect(waveLpf).connect(waveGain).connect(master);
  wave.start();
  nodes.push(wave, waveLfo);

  const foam = ctx.createBufferSource();
  foam.buffer = createNoise(ctx, 3);
  foam.loop = true;
  const foamBpf = ctx.createBiquadFilter();
  foamBpf.type = "highpass";
  foamBpf.frequency.value = 2000;
  const foamGain = ctx.createGain();
  foamGain.gain.value = 0;
  const foamLfo = ctx.createOscillator();
  foamLfo.type = "sine";
  foamLfo.frequency.value = 0.06;
  const foamLfoGain = ctx.createGain();
  foamLfoGain.gain.value = 0.08;
  foamLfo.connect(foamLfoGain);
  foamLfoGain.connect(foamGain.gain);
  foamLfo.start();
  foam.connect(foamBpf).connect(foamGain).connect(master);
  foam.start();
  nodes.push(foam, foamLfo);

  return nodes;
}

function createSpace(ctx: AudioContext, master: GainNode): AudioNode[] {
  const nodes: AudioNode[] = [];

  const drone1 = ctx.createOscillator();
  drone1.type = "sine";
  drone1.frequency.value = 60;
  const drone1Gain = ctx.createGain();
  drone1Gain.gain.value = 0.15;
  drone1.connect(drone1Gain).connect(master);
  drone1.start();
  nodes.push(drone1);

  const drone2 = ctx.createOscillator();
  drone2.type = "sine";
  drone2.frequency.value = 90;
  const drone2Gain = ctx.createGain();
  drone2Gain.gain.value = 0.1;
  const droneLfo = ctx.createOscillator();
  droneLfo.type = "sine";
  droneLfo.frequency.value = 0.05;
  const droneLfoGain = ctx.createGain();
  droneLfoGain.gain.value = 0.06;
  droneLfo.connect(droneLfoGain);
  droneLfoGain.connect(drone2Gain.gain);
  droneLfo.start();
  drone2.connect(drone2Gain).connect(master);
  drone2.start();
  nodes.push(drone2, droneLfo);

  const hiss = ctx.createBufferSource();
  hiss.buffer = createNoise(ctx, 4);
  hiss.loop = true;
  const hissLpf = ctx.createBiquadFilter();
  hissLpf.type = "lowpass";
  hissLpf.frequency.value = 200;
  hissLpf.Q.value = 0.3;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.08;
  hiss.connect(hissLpf).connect(hissGain).connect(master);
  hiss.start();
  nodes.push(hiss);

  for (let i = 0; i < 2; i++) {
    const shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = 800 + i * 500;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0;
    const shimmerLfo = ctx.createOscillator();
    shimmerLfo.type = "sine";
    shimmerLfo.frequency.value = 0.03 + i * 0.02;
    const shimmerLfoGain = ctx.createGain();
    shimmerLfoGain.gain.value = 0.02;
    shimmerLfo.connect(shimmerLfoGain);
    shimmerLfoGain.connect(shimmerGain.gain);
    shimmerLfo.start();
    shimmer.connect(shimmerGain).connect(master);
    shimmer.start();
    nodes.push(shimmer, shimmerLfo);
  }

  return nodes;
}

export function startAmbientSound(type: AmbientType, volume: number): void {
  stopAmbientSound();

  const ctx = getContext();
  gainNode = ctx.createGain();
  gainNode.gain.value = Math.max(0, Math.min(1, volume / 100));
  gainNode.connect(ctx.destination);

  const generators: Record<AmbientType, (ctx: AudioContext, g: GainNode) => AudioNode[]> = {
    rain: createRain,
    forest: createForest,
    ocean: createOcean,
    space: createSpace,
  };

  activeNodes = generators[type](ctx, gainNode);
}

export function setAmbientVolume(volume: number): void {
  if (gainNode) {
    gainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, volume / 100)), gainNode.context.currentTime, 0.1);
  }
}

export function stopAmbientSound(): void {
  for (const node of activeNodes) {
    try {
      if (node instanceof AudioBufferSourceNode) node.stop();
      else if (node instanceof OscillatorNode) node.stop();
      node.disconnect();
    } catch {}
  }
  activeNodes = [];
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
}
