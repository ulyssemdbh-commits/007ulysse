"""
Ulysse TTS Service — Piper Engine
Flask service on port 5002
Architecture: Model preloaded in RAM, LRU audio cache, circuit-breaker-ready
Endpoints: POST /tts  |  GET /health  |  GET /metrics
"""

import os
import io
import time
import wave
import base64
import hashlib
import logging
import threading
import traceback
from collections import OrderedDict
from pathlib import Path
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="[PiperTTS] %(message)s")
log = logging.getLogger("piper_tts")

app = Flask(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
PORT         = int(os.environ.get("PIPER_PORT", "5002"))
VOICE_NAME   = os.environ.get("PIPER_VOICE", "fr_FR-upmc-medium")
MODELS_DIR   = Path(os.environ.get("PIPER_MODELS_DIR", "piper_tts/models"))
CACHE_MAX    = int(os.environ.get("PIPER_CACHE_MAX", "300"))   # max RAM cache entries
OUTPUT_FORMAT = "mp3"

# ── State ──────────────────────────────────────────────────────────────────────
voice_engine   = None          # PiperVoice instance (preloaded)
model_ready    = threading.Event()
engine_lock    = threading.Lock()

# LRU audio cache: key = sha1(voice+text), val = mp3 base64 string
audio_cache: OrderedDict = OrderedDict()
cache_lock = threading.Lock()

# Metrics
metrics = {
    "requests": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "errors": 0,
    "total_latency_ms": 0.0,
    "started_at": time.time(),
}
metrics_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────────────

def cache_key(text: str, voice: str) -> str:
    return hashlib.sha1(f"{voice}::{text}".encode()).hexdigest()


def lru_get(key: str):
    with cache_lock:
        if key in audio_cache:
            audio_cache.move_to_end(key)
            return audio_cache[key]
    return None


def lru_set(key: str, value: str):
    with cache_lock:
        if key in audio_cache:
            audio_cache.move_to_end(key)
        else:
            if len(audio_cache) >= CACHE_MAX:
                audio_cache.popitem(last=False)  # evict oldest
        audio_cache[key] = value


def synthesize_to_wav(text: str) -> bytes:
    """Synthesize text → WAV bytes (raw, no conversion — fastest path)."""
    global voice_engine
    with engine_lock:
        if voice_engine is None:
            raise RuntimeError("Voice engine not loaded")

        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wf:
            voice_engine.synthesize_wav(text, wf)
        return wav_io.getvalue()


# ── Model loader ───────────────────────────────────────────────────────────────

def load_model():
    global voice_engine
    try:
        log.info(f"Loading voice model: {VOICE_NAME}")
        from piper import PiperVoice
        from piper.download_voices import download_voice

        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        onnx_file = MODELS_DIR / f"{VOICE_NAME}.onnx"
        if not onnx_file.exists() or onnx_file.stat().st_size < 1024:
            if onnx_file.exists() and onnx_file.stat().st_size < 1024:
                log.warning(f"Model file corrupted (size={onnx_file.stat().st_size}B), re-downloading...")
                onnx_file.unlink()
            log.info(f"Downloading {VOICE_NAME} from Hugging Face...")
            download_voice(VOICE_NAME, MODELS_DIR)
            log.info("Download complete")
        else:
            log.info(f"Model already cached: {onnx_file}")

        model_path = str(onnx_file)
        log.info(f"Loading model into RAM: {model_path}")
        with engine_lock:
            voice_engine = PiperVoice.load(model_path)

        log.info(f"✅ Model ready — sample_rate={voice_engine.config.sample_rate}Hz")
        model_ready.set()

        # Warm-up cache in background
        threading.Thread(target=warmup_cache, daemon=True).start()

    except Exception as e:
        log.error(f"Failed to load model: {e}")
        traceback.print_exc()
        # Don't set model_ready — service will return 503


def warmup_cache():
    """Pre-synthesize common Ulysse phrases → instant cache hits at runtime."""
    WARMUP_PHRASES = [
        "Je suis là, qu'est-ce que je peux faire pour toi ?",
        "Un instant, je réfléchis.",
        "D'accord, je m'en occupe.",
        "Voilà !",
        "Bien sûr.",
        "Parfait.",
        "Je n'ai pas compris, tu peux répéter ?",
        "Je suis prêt.",
        "C'est noté.",
        "Je cherche ça pour toi.",
        "Laisse-moi vérifier ça.",
        "C'est fait.",
        "Je reviens tout de suite.",
        "Pas de problème.",
        "Entendu.",
        "Tu veux que je continue ?",
        "Je t'écoute.",
        "Qu'est-ce que tu veux savoir ?",
        "Bonjour, je suis Ulysse.",
    ]
    log.info(f"Warming up cache with {len(WARMUP_PHRASES)} phrases...")
    warmed = 0
    for text in WARMUP_PHRASES:
        try:
            key = cache_key(text, VOICE_NAME)
            if lru_get(key) is None:
                wav = synthesize_to_wav(text)
                lru_set(key, base64.b64encode(wav).decode())
                warmed += 1
        except Exception as e:
            log.warning(f"Warmup failed for '{text[:30]}': {e}")
    log.info(f"Cache warm-up complete: {warmed}/{len(WARMUP_PHRASES)} phrases cached")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/tts", methods=["POST"])
def tts():
    t_start = time.monotonic()

    with metrics_lock:
        metrics["requests"] += 1

    if not model_ready.is_set():
        with metrics_lock:
            metrics["errors"] += 1
        return jsonify({"error": "Model not ready yet"}), 503

    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()

    if not text or len(text) < 2:
        return jsonify({"error": "text too short"}), 400

    voice = data.get("voice", VOICE_NAME)
    use_cache = data.get("cache", True)

    key = cache_key(text, voice)

    # Cache hit?
    if use_cache:
        cached = lru_get(key)
        if cached:
            with metrics_lock:
                metrics["cache_hits"] += 1
                metrics["total_latency_ms"] += (time.monotonic() - t_start) * 1000
            return jsonify({
                "audio_base64": cached,
                "mime_type": "audio/wav",
                "cached": True,
                "latency_ms": round((time.monotonic() - t_start) * 1000, 1),
            })

    with metrics_lock:
        metrics["cache_misses"] += 1

    # Synthesize → WAV direct (no conversion, fastest path)
    try:
        wav_bytes = synthesize_to_wav(text)
        audio_b64 = base64.b64encode(wav_bytes).decode()

        if use_cache:
            lru_set(key, audio_b64)

        latency = round((time.monotonic() - t_start) * 1000, 1)
        with metrics_lock:
            metrics["total_latency_ms"] += latency

        return jsonify({
            "audio_base64": audio_b64,
            "mime_type": "audio/wav",
            "cached": False,
            "latency_ms": latency,
        })

    except Exception as e:
        log.error(f"Synthesis error: {e}")
        with metrics_lock:
            metrics["errors"] += 1
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    with cache_lock:
        cache_size = len(audio_cache)
    return jsonify({
        "status": "ok" if model_ready.is_set() else "loading",
        "model": VOICE_NAME,
        "model_ready": model_ready.is_set(),
        "cache_entries": cache_size,
        "cache_max": CACHE_MAX,
    })


@app.route("/metrics", methods=["GET"])
def get_metrics():
    with metrics_lock:
        m = dict(metrics)
    total = m["requests"]
    avg_latency = (m["total_latency_ms"] / total) if total > 0 else 0
    hit_rate = (m["cache_hits"] / total * 100) if total > 0 else 0
    with cache_lock:
        m["cache_entries"] = len(audio_cache)
    return jsonify({
        **m,
        "avg_latency_ms": round(avg_latency, 1),
        "cache_hit_rate_pct": round(hit_rate, 1),
        "uptime_s": round(time.time() - m["started_at"]),
    })


@app.route("/cache/clear", methods=["POST"])
def clear_cache():
    with cache_lock:
        audio_cache.clear()
    return jsonify({"status": "cache cleared"})


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Load model in background thread so Flask starts immediately
    threading.Thread(target=load_model, daemon=True).start()
    log.info(f"Starting Piper TTS service on port {PORT}...")
    app.run(host="0.0.0.0", port=PORT, threaded=True)
