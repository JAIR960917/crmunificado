import { describe, expect, it } from "vitest";
import { needsWhatsAppAudioConversion } from "./convertAudioForWhatsApp";

describe("needsWhatsAppAudioConversion", () => {
  it("detecta webm", () => {
    expect(needsWhatsAppAudioConversion("audio/webm")).toBe(true);
    expect(needsWhatsAppAudioConversion("audio/webm;codecs=opus")).toBe(true);
  });

  it("ignora formatos aceitos pela Meta", () => {
    expect(needsWhatsAppAudioConversion("audio/ogg")).toBe(false);
    expect(needsWhatsAppAudioConversion("audio/mpeg")).toBe(false);
    expect(needsWhatsAppAudioConversion("audio/mp3")).toBe(false);
  });
});
