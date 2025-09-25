#!/usr/bin/env python3
import argparse
import json
import os
import sys

try:
    from faster_whisper import WhisperModel
except Exception as e:
    print(json.dumps({"error": f"Failed to import faster_whisper: {e}"}))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Lightweight LID using faster-whisper")
    parser.add_argument("--input", required=True, help="Path to audio file (wav/ogg/webm)")
    parser.add_argument("--model", default="tiny", help="Whisper model size (default: tiny)")
    parser.add_argument("--device", default="cpu", help="Device (cpu/cuda)")
    parser.add_argument("--compute_type", default="int8", help="Compute type (e.g., int8, int8_float16, float16)")
    parser.add_argument("--no_speech_threshold", type=float, default=0.6, help="No-speech threshold")
    parser.add_argument("--vad_min_ms", type=int, default=250, help="VAD min speech duration ms")
    parser.add_argument("--vad_max_s", type=float, default=30.0, help="VAD max speech segment length seconds")
    parser.add_argument("--vad_pad_ms", type=int, default=30, help="VAD speech pad ms")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(2)

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        # Only detect language; avoid transcribing entire audio for speed
        vad_params = dict(min_speech_duration_ms=args.vad_min_ms,
                          max_speech_duration_s=args.vad_max_s,
                          speech_pad_ms=args.vad_pad_ms)
        segments, info = model.transcribe(
            args.input,
            language=None,
            task="transcribe",
            vad_filter=True,
            vad_parameters=vad_params,
            no_speech_threshold=args.no_speech_threshold,
            without_timestamps=True
        )
        lang = getattr(info, 'language', None)
        prob = getattr(info, 'language_probability', None)
        result = {"language": lang, "confidence": float(prob) if prob is not None else None}
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(3)


if __name__ == "__main__":
    main()


