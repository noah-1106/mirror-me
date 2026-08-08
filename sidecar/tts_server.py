"""本地语音 sidecar：ChatTTS（主，固定声线）+ Kokoro（备）+ FunASR ASR"""
import io
import os
import re
import subprocess
import tempfile

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile
from fastapi.responses import Response
from kokoro import KPipeline

app = FastAPI()
pipeline = KPipeline(lang_code="z")  # z = 中文

# ── ChatTTS：世界的声音，声线由用户名哈希锁定（每人稳定一条）──
_chats: dict = {}
KOKORO_FALLBACK = {"a": "zf_xiaobei", "b": "zm_yunjian"}
CHAT_MODEL_PATH = os.path.expanduser(
    "~/.cache/huggingface/hub/models--2Noise--ChatTTS/snapshots/1a3c04a8b0651689bd9242fbb55b1f4b5a9aef84"
)


def persona_seed(persona: str) -> int:
    import hashlib

    return int(hashlib.md5(persona.encode()).hexdigest(), 16) % 100000


def get_chat(persona: str):
    if persona not in _chats:
        import ChatTTS

        torch.manual_seed(persona_seed(persona))
        chat = ChatTTS.Chat()
        if not chat.load(source="custom", custom_path=CHAT_MODEL_PATH, compile=False):
            return None, None
        _chats[persona] = (chat, chat.sample_random_speaker())
    return _chats[persona]


def synthesize_chattts(text: str, persona: str = "a") -> np.ndarray | None:
    chat, spk = get_chat(persona)
    if chat is None:
        return None
    import ChatTTS

    params = ChatTTS.Chat.InferCodeParams(spk_emb=spk, temperature=0.3)
    wavs = chat.infer([text], params_infer_code=params)
    if not wavs:
        return None
    return np.asarray(wavs[0], dtype=np.float32)

# 预置人设音色（Kokoro 备胎用）
VOICES = {
    "xiaobei": "zf_xiaobei",   # 女声·清亮
    "xiaoni": "zf_xiaoni",     # 女声·柔和
    "xiaoxiao": "zf_xiaoxiao", # 女声·活泼
    "yunjian": "zm_yunjian",   # 男声·沉稳
    "yunxi": "zm_yunxi",       # 男声·清亮
    "yunyang": "zm_yunyang",   # 男声·厚实
}

_asr_model = None

# 本地 SenseVoiceSmall（中文识别强档，无需联网下载）
_ASR_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "SenseVoiceSmall")

# ── CosyVoice2 本地零样本声线克隆（用户本人声音，进入时已知情同意）──
import threading

_cosy = None
_model_lock = threading.Lock()  # 预热线程与请求线程可能同时首载，加锁防双载
_COSY_MODEL_DIR = os.path.expanduser(
    "~/.cache/huggingface/hub/models--FunAudioLLM--CosyVoice2-0.5B/snapshots/eec1ae6c79877dbd9379285cf8789c9e0879293d"
)
_REF_DIR = os.path.join(os.path.dirname(__file__), "models", "refs")
os.makedirs(_REF_DIR, exist_ok=True)


def get_cosy():
    global _cosy
    if _cosy is None:
        with _model_lock:
            if _cosy is None:
                import sys

                here = os.path.dirname(__file__)
                sys.path.insert(0, os.path.join(here, "vendor", "CosyVoice"))
                sys.path.insert(0, os.path.join(here, "vendor", "CosyVoice", "third_party", "Matcha-TTS"))
                from cosyvoice.cli.cosyvoice import CosyVoice2

                _cosy = CosyVoice2(_COSY_MODEL_DIR)
    return _cosy


def persona_dir(persona: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9一-鿿_-]", "", persona)[:32] or "anon"
    d = os.path.join(_REF_DIR, safe)
    os.makedirs(d, exist_ok=True)
    return d


def ref_wav(persona: str) -> str:
    return os.path.join(persona_dir(persona), "ref.wav")


def ref_clip_count(persona: str) -> int:
    d = persona_dir(persona)
    return len([f for f in os.listdir(d) if f.startswith("clip-") and f.endswith(".wav")])


def _clip_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def _build_ref(persona: str, d: str, clips: list) -> None:
    """从候选 clip 构建参考音频：
    - 选时长最接近 8 秒的（CosyVoice 零样本甜区是 5-10 秒干净独白；19s+ 的长 prompt 会出"鬼念经"）
    - 降噪 + 响度归一 + 截 12 秒上限（浏览器麦克风实录噪声/混响重，不处理会出电音鬼声）
    """
    best = min(clips, key=lambda c: abs(_clip_duration(os.path.join(d, c)) - 8.0))
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", os.path.join(d, best),
            "-af", "highpass=f=70,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:12",
            "-ar", "22050", "-ac", "1", ref_wav(persona),
        ],
        check=True,
        capture_output=True,
    )
    # 参考音频变了，转写缓存作废（下次 clone 时重新转写）
    cache = os.path.join(d, "ref.txt")
    if os.path.exists(cache):
        os.unlink(cache)


@app.post("/collect")
async def collect(persona: str, file: UploadFile):
    """逐轮收集语音（进入时已知情同意）：每段录音存为克隆参考素材"""
    data = await file.read()
    if not data:
        return {"ok": False}
    d = persona_dir(persona)
    n = ref_clip_count(persona) + 1
    src = tempfile.NamedTemporaryFile(suffix=".webm", delete=False).name
    with open(src, "wb") as f:
        f.write(data)
    dst = os.path.join(d, f"clip-{n}.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", "22050", "-ac", "1", dst],
        check=True,
        capture_output=True,
    )
    os.unlink(src)
    # 有 2 段以上即克隆就绪：从候选 clip 构建一条干净参考音频
    clips = sorted(f for f in os.listdir(d) if f.startswith("clip-"))
    ready = len(clips) >= 2
    if ready:
        _build_ref(persona, d, clips)
    return {"ok": True, "clips": len(clips), "clone_ready": ready}


@app.delete("/refs/{persona}")
def delete_refs(persona: str):
    """离开即清除：删除该用户的全部声纹素材"""
    import shutil

    d = persona_dir(persona)
    if os.path.exists(d):
        shutil.rmtree(d)
    return {"ok": True}


def ref_text(persona: str) -> str:
    """参考音频的转写文本（CosyVoice 零样本需要）：本地 SenseVoice 转写，按 persona 缓存"""
    cache = os.path.join(persona_dir(persona), "ref.txt")
    if os.path.exists(cache):
        with open(cache) as f:
            return f.read()
    result = get_asr().generate(input=ref_wav(persona))
    raw = result[0]["text"] if result else ""
    text = re.sub(r"<\|[^|]+\|>", "", raw).strip()
    with open(cache, "w") as f:
        f.write(text)
    return text


def synthesize_clone(text: str, persona: str) -> np.ndarray | None:
    """克隆就绪则用 CosyVoice2 以本人声音合成，未就绪返回 None 走 ChatTTS"""
    if not os.path.exists(ref_wav(persona)):
        return None
    try:
        cosy = get_cosy()
        for out in cosy.inference_zero_shot(text, ref_text(persona), ref_wav(persona)):
            audio = out["tts_speech"].squeeze().numpy()
            return np.asarray(audio, dtype=np.float32)
        return None
    except Exception as e:
        print("[cosyvoice] clone failed:", e)
        return None


def get_asr():
    """FunASR SenseVoiceSmall（本地模型）。首次调用时加载。"""
    global _asr_model
    if _asr_model is None:
        with _model_lock:
            if _asr_model is None:
                from funasr import AutoModel

                _asr_model = AutoModel(model=_ASR_MODEL_PATH, disable_update=True)
    return _asr_model


@app.on_event("startup")
def prewarm():
    """后台预载 CosyVoice + ASR：把 20s+ 的冷启动从用户路径挪到开机时"""

    def _load():
        try:
            get_cosy()
            print("[prewarm] cosyvoice ready")
        except Exception as e:
            print("[prewarm] cosyvoice failed:", e)
        try:
            get_asr()
            print("[prewarm] asr ready")
        except Exception as e:
            print("[prewarm] asr failed:", e)

    threading.Thread(target=_load, daemon=True).start()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/voices")
def voices():
    return {"voices": list(VOICES.keys())}


@app.post("/tts")
def tts(body: dict):
    text = str(body.get("text", ""))[:300]
    if not text.strip():
        return Response(status_code=400)

    if body.get("mode") == "ambient":
        # 世界引擎之声：风声和弦——无语言、宏大、母性。
        # 按文本哈希确定性选和弦走向（同一句话永远得到同一条回应）
        chord = AMBIENT_CHORDS[stable_hash(text) % len(AMBIENT_CHORDS)]
        data = generate_ambient(chord, duration=5.0)
        return Response(data, media_type="audio/wav")

    # 未来的自己的声音只能是本人声纹：复刻未就绪则静默（文字呈现），绝不用替身声线
    persona = str(body.get("voice", "a"))
    audio = synthesize_clone(text, persona)
    if audio is None:
        return Response(status_code=204)

    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    return Response(buf.getvalue(), media_type="audio/wav")


def stable_hash(text: str) -> int:
    import hashlib

    return int(hashlib.md5(text.encode()).hexdigest(), 16)


# 世界之声的和弦走向（Dm9 / Am add9 / Fmaj9 / Gm9）
AMBIENT_CHORDS = [
    [73.42, 110.0, 174.61, 261.63, 329.63],
    [55.0, 110.0, 164.81, 261.63, 293.66],
    [87.31, 130.81, 174.61, 220.0, 329.63],
    [98.0, 146.83, 196.0, 293.66, 349.23],
]


def generate_ambient(freqs: list, duration: float) -> bytes:
    """ffmpeg 程序化生成：低弦长音 + 棕噪声风声 + 慢起慢收 + 大厅混响"""
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={duration}"]
    inputs += ["-f", "lavfi", "-i", f"anoisesrc=color=brown:duration={duration}:amplitude=0.5"]
    n = len(freqs)
    gains = [0.5, 0.4, 0.25, 0.18, 0.12]
    parts = "".join(f"[{i}]volume={gains[i]}[s{i}];" for i in range(n))
    parts += f"[{n}]lowpass=f=400,volume=0.3[nz];"
    mix = "".join(f"[s{i}]" for i in range(n)) + "[nz]"
    fade = f"min(1,t/2)*min(1,({duration}-t)/2)"
    filters = (
        parts
        + f"{mix}amix=inputs={n + 1}:normalize=0,"
        + f"volume='{fade}':eval=frame,tremolo=f=0.4:d=0.3,lowpass=f=2500,"
        + "aecho=0.7:0.9:100:0.4,volume=1.4"
    )
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filters, "-t", str(duration), out],
        check=True,
        capture_output=True,
    )
    with open(out, "rb") as f:
        data = f.read()
    os.unlink(out)
    return data


@app.post("/asr")
async def asr(file: UploadFile):
    data = await file.read()
    if not data:
        return Response(status_code=400)
    src = None
    wav = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(data)
            src = f.name
        wav = src + ".wav"
        subprocess.run(
            ["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", wav],
            check=True,
            capture_output=True,
        )
        result = get_asr().generate(input=wav)
        raw = result[0]["text"] if result else ""
        # SenseVoice 输出带元信息标签（语种/情绪/事件），剥掉只留文本
        text = re.sub(r"<\|[^|]+\|>", "", raw).strip()
        return {"text": text}
    except Exception as e:
        return {"text": "", "error": str(e)}
    finally:
        for path in (src, wav):
            if path and os.path.exists(path):
                os.unlink(path)  # 原始音频即取即弃——红线
