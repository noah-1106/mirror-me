import { useEffect, useRef, useState } from 'react';
import { computeCandidates } from '../engine/selves';
import { getProfile } from '../engine/session';
import { useWorldState } from '../engine/useWorld';
import { useWorldStore } from '../store/worldStore';

const PHASE_HINT: Record<string, string> = {
  genesis: '人生正在凝聚…',
  idle: '世界之树在倾听你的故事',
  observing: '观观在听…',
  converging: '敛敛在收敛，未来正在生长…',
  responding: '…',
  finale: '树已成形。你可以见未来的自己，也可以让它继续长。',
  dialogue: '他记得你说过的每一句话',
};

const MAX_RECORD_SECONDS = 20;

/** 语音输入开关：线上（Vercel）无 sidecar，构建时以 VITE_ENABLE_VOICE=false 关闭说话按钮 */
const VOICE_ENABLED = import.meta.env.VITE_ENABLE_VOICE !== 'false';

/**
 * 语音输入：MediaRecorder 录音 → /api/asr（本地 FunASR）→ 引擎。
 * 不依赖浏览器 SpeechRecognition（其云端服务在国内不可用）。
 * 停顿时长 = 进入 idle 到开口的实测时间；录音时长即 durationMs。
 */
export function VoiceInput() {
  const { phase, state, context, send } = useWorldState();
  const focusedSelf = useWorldStore((s) => s.focusedSelf);
  const setFocusedSelf = useWorldStore((s) => s.setFocusedSelf);
  const revealedTurn = useWorldStore((s) => s.revealedTurn);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_RECORD_SECONDS);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const idleSince = useRef<number>(Date.now());
  const recordStart = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase === 'idle') idleSince.current = Date.now();
  }, [phase]);

  const submit = (transcript: string, durationMs?: number) => {
    const trimmed = transcript.trim();
    // 终局里只有 dialogue 稳态可提交（summoning/dialogueTurn 期间事件会被状态机丢弃）
    const canSubmit =
      phase === 'idle' || (phase === 'dialogue' && state === 'dialogue' && focusedSelf);
    if (!trimmed || !canSubmit) return;
    send({
      type: 'VOICE_TURN',
      transcript: trimmed,
      pauseMs: Date.now() - idleSince.current,
      durationMs: durationMs ?? Math.max(300, trimmed.length * 180),
    });
    setText('');
  };

  const stopRecording = () => {
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    recorderRef.current?.stop();
  };

  const toggleRecording = async () => {
    if (recording) {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const durationMs = Date.now() - recordStart.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const res = await fetch(`/api/asr?voice=${encodeURIComponent(getProfile())}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
          });
          const data = await res.json();
          if (data.text?.trim()) {
            setText(data.text);
            submit(data.text, durationMs);
          } else {
            setMicError('没听清，再说一次试试？');
          }
        } catch {
          setMicError('识别服务没接上，先用打字吧');
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recordStart.current = Date.now();
      setMicError(null);
      setRecording(true);
      setSecondsLeft(MAX_RECORD_SECONDS);
      countdownRef.current = setInterval(
        () => setSecondsLeft((s) => Math.max(0, s - 1)),
        1000
      );
      recorder.start();
      maxTimerRef.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);
    } catch {
      setMicError('麦克风没接通，请检查浏览器权限，或直接打字');
    }
  };

  // 进入终局稳态时自动聚焦第一个"我"（每次终局只做一次——之后焦点由用户掌控，
  // 否则"回到全景"会被立刻拽回去）
  const autoFocused = useRef(false);
  useEffect(() => {
    if (phase !== 'dialogue') {
      autoFocused.current = false;
      return;
    }
    if (state === 'dialogue' && !autoFocused.current && context.activeSelf) {
      autoFocused.current = true;
      setFocusedSelf(context.activeSelf);
    }
  }, [phase, state, context.activeSelf, setFocusedSelf]);

  // 当前聚焦的"我"的名签
  const focusedCandidate =
    phase === 'dialogue' && focusedSelf
      ? computeCandidates(context.tree, context.history).find((c) => c.branchId === focusedSelf)
      : undefined;
  const selfLabel = focusedCandidate
    ? focusedCandidate.withered
      ? '灰烬枝上的你'
      : focusedCandidate.basin === 'other'
        ? '冷银枝上的你'
        : '暖金枝上的你'
    : '';

  // 字随声现：音频开始播放（或确定无声）才揭开文字；此前提示声音在凝聚
  const replyRevealed = context.replyTurn >= 0 && revealedTurn >= context.replyTurn;
  const voiceGathering =
    phase === 'dialogue' && state === 'dialogue' && !!context.reply && !replyRevealed;

  const hint = micError
    ? micError
    : recording
      ? '我在听…说完再点一下'
      : transcribing
        ? '识别中…'
        : state === 'summoning'
          ? '他正在从枝头醒来…'
          : voiceGathering
            ? '他的声音正在凝聚…'
            : PHASE_HINT[phase];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-8">
      <div className="rounded-full bg-black/45 px-4 py-1.5 text-sm font-light tracking-widest text-white/50 backdrop-blur-sm">{hint}</div>
      {phase === 'idle' && (
        <div className="pointer-events-auto flex w-full max-w-xl items-center gap-3 px-6">
          {VOICE_ENABLED && (
            <button
              onClick={toggleRecording}
              disabled={transcribing}
              className={`rounded-full px-5 py-3 text-sm transition-colors ${
                recording
                  ? 'animate-pulse bg-red-500/70 text-white'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {recording ? `停止 ${secondsLeft}s` : '说话'}
            </button>
          )}
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(text)}
            placeholder={recording ? '说吧，我在听…' : '说说你最近的一件心事…'}
            className="flex-1 rounded-full border border-white/20 bg-black/40 px-5 py-3 text-sm text-white placeholder-white/40 outline-none backdrop-blur-md focus:border-white/40"
          />
          <button
            onClick={() => submit(text)}
            className="rounded-full bg-white/10 px-5 py-3 text-sm text-white transition-colors hover:bg-white/20"
          >
            发送
          </button>
        </div>
      )}
      {phase === 'finale' && (
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            onClick={() => send({ type: 'CONTINUE' })}
            className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm text-white backdrop-blur-md transition-colors hover:bg-white/20"
          >
            继续对话，让树继续长
          </button>
          <button
            onClick={() => send({ type: 'FINISH' })}
            className="rounded-full border border-[#ffd9a0]/40 bg-[#ffd9a0]/10 px-6 py-3 text-sm text-[#ffe9c9] backdrop-blur-md transition-colors hover:bg-[#ffd9a0]/20"
          >
            见未来的自己
          </button>
        </div>
      )}
      {phase === 'dialogue' && (
        <div className="pointer-events-auto flex w-full max-w-xl flex-col items-center gap-4 px-6">
          {state === 'summoning' ? null : !focusedSelf ? (
            <div className="rounded-full bg-black/45 px-5 py-2 text-sm font-light tracking-widest text-white/60 backdrop-blur-sm">
              树上有三团呼吸的光——每一团，都是一个你
            </div>
          ) : (
            <>
              <div className="rounded-full bg-black/45 px-4 py-1 text-xs font-light tracking-[0.3em] text-white/50 backdrop-blur-sm">
                {selfLabel}
              </div>
              {context.reply && replyRevealed && (
                <div className="sacred-text max-w-lg text-center text-xl leading-relaxed">
                  {context.reply}
                </div>
              )}
              <div className="flex w-full items-center gap-3">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit(text)}
                  disabled={state === 'dialogueTurn'}
                  placeholder={state === 'dialogueTurn' ? '他在想…' : '对他说点什么…'}
                  className="flex-1 rounded-full border border-white/20 bg-black/40 px-5 py-3 text-sm text-white placeholder-white/40 outline-none backdrop-blur-md focus:border-white/40 disabled:opacity-50"
                />
                <button
                  onClick={() => submit(text)}
                  disabled={state === 'dialogueTurn'}
                  className="rounded-full bg-white/10 px-5 py-3 text-sm text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  发送
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setFocusedSelf(null)}
                  className="rounded-full bg-black/45 px-4 py-1.5 text-xs text-white/60 backdrop-blur-sm transition-colors hover:text-white/90"
                >
                  回到全景，换一团光
                </button>
                <button
                  onClick={() => {
                    setFocusedSelf(null);
                    send({ type: 'EXIT_DIALOGUE' });
                  }}
                  className="rounded-full bg-black/45 px-4 py-1.5 text-xs text-white/40 backdrop-blur-sm transition-colors hover:text-white/70"
                >
                  回到树下
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
