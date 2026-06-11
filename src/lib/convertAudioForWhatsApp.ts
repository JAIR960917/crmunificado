import { Mp3Encoder } from "@/lib/vendor/lamejs.js";

export function needsWhatsAppAudioConversion(mimeType: string): boolean {
  return (mimeType || "").toLowerCase().includes("webm");
}

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { length, numberOfChannels } = audioBuffer;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channel = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += channel[i] / numberOfChannels;
  }
  return mono;
}

async function webmBlobToMp3Blob(blob: Blob): Promise<Blob> {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const pcm = floatTo16BitPCM(mixToMono(audioBuffer));
    const encoder = new Mp3Encoder(1, audioBuffer.sampleRate, 128);
    const blockSize = 1152;
    const mp3Parts: Uint8Array[] = [];

    for (let i = 0; i < pcm.length; i += blockSize) {
      const chunk = pcm.subarray(i, i + blockSize);
      const encoded = encoder.encodeBuffer(chunk);
      if (encoded.length > 0) mp3Parts.push(new Uint8Array(encoded));
    }

    const flushed = encoder.flush();
    if (flushed.length > 0) mp3Parts.push(new Uint8Array(flushed));

    return new Blob(mp3Parts as BlobPart[], { type: "audio/mpeg" });
  } finally {
    await audioContext.close();
  }
}

/** Converte WebM (gravado no Edge/Safari) para MP3 aceito pela Meta. */
export async function prepareAudioFileForWhatsApp(file: File): Promise<File> {
  if (!needsWhatsAppAudioConversion(file.type)) return file;

  const mp3Blob = await webmBlobToMp3Blob(file);
  const baseName = file.name.replace(/\.webm$/i, "") || `audio-${Date.now()}`;
  return new File([mp3Blob], `${baseName}.mp3`, { type: "audio/mpeg" });
}
