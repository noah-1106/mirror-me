# 与未来的自己对话

OASIS 式世界引擎 × 观观/敛敛双 Agent：孩子在空白世界里说话，世界长给他看。

- 无聊天框：72 根时间线编织成树，每句话经 LLM 析取可能性方向，向未来长出真实分岔的新枝
- 双声部：世界用风声和弦回应（无语言）+ 全息浮字；终局「未来的自己」才说人话
- 声纹复刻：本地 CosyVoice2 零样本复刻**演示者本人**的声音（知情同意）；**未复刻就绪则静默，绝不用替身声线**
- 全栈本地可演：ASR/TTS 全部本地模型，LLM 无 key 走兜底池

## 技术栈

- 前端：React 18 + Vite + TypeScript + react-three-fiber + XState + zustand
- 服务端：Express + TypeScript + DeepSeek/Kimi（OpenAI 兼容，推理模型）
- 语音 sidecar：FastAPI + CosyVoice2-0.5B（声纹复刻）+ FunASR SenseVoiceSmall（ASR）+ ffmpeg（风声和弦生成）
- Monorepo：pnpm workspace

## 环境要求

- Node 20+ / pnpm 9+
- Python 3.12 + ffmpeg（含 ffprobe）
- 首次运行需联网拉模型（走 hf-mirror 国内镜像，共约 3-4G）
- macOS / Linux（CPU 可跑；有 GPU 更快）

## 启动（三个进程）

```bash
pnpm install

# 1. 语音 sidecar
cd sidecar && python3 -m venv venv
./venv/bin/pip install kokoro "misaki[zh]" soundfile fastapi "uvicorn[standard]" \
  funasr python-multipart torchaudio librosa gdown wget pyarrow "setuptools<81" \
  hyperpyyaml modelscope onnxruntime openai-whisper inflect regex conformer \
  diffusers lightning x-transformers einops omegaconf pyworld "transformers==4.51.3"
git clone --depth 1 --recursive https://github.com/FunAudioLLM/CosyVoice.git vendor/CosyVoice
HF_ENDPOINT=https://hf-mirror.com ./venv/bin/huggingface-cli download FunAudioLLM/CosyVoice2-0.5B
HF_ENDPOINT=https://hf-mirror.com ./venv/bin/uvicorn tts_server:app --port 5100
# （CosyVoice2 + ASR 模型启动时后台预热；SenseVoiceSmall 在 sidecar/models/ 内）

# 2. 服务端（配置 LLM key）
cp server/.env.example server/.env   # 填入 DEEPSEEK_API_KEY
pnpm dev:server

# 3. 前端
pnpm dev:web
```

前端 `http://localhost:5173` ｜ 服务端 `:3001` ｜ sidecar `:5100`

**依赖版本红线**（踩过的坑，勿升级）：
- `transformers==4.51.3`：CosyVoice 官方 pin；4.55 会让语音 token 退化（"鬼念经"）
- `setuptools<81`：pyworld 依赖 pkg_resources，≥81 已移除

## 体验路径

1. 姓名 + 知情同意 →「轻触进入」（音画同时启动）
2. 人生履历凝聚：种子 → 72 股线编织 → 递归分叉成冠（约 20 秒，代表已活过的时光）
3. 「世界之树在倾听你的故事」：语音（≤20s）/打字 → 观观扫描 → LLM 打标（盆地+心理维度）→ 敛敛收敛 → **LLM 析取这句话真正包含的 1-4 个可能性方向，每个方向长一根枝**
4. 世界回应：风声和弦 + 全息浮字（字随声现）；右下角引擎实况四个数字全部实时真算：
   亲手点亮的可能 / 由自己点亮的选择 / 被照亮的生活面 / 推演不动的路口（枯枝）
5. 收敛达标后 **LLM 判定故事充分度**（具体性/自我暴露/多样性）：不够就继续长，够了才叩门
6. 终局「见未来的自己」：树上亮起三团呼吸的光（三个真实从枝上长出来的"我"），镜头跟进对话；
   光团按盆地分色——暖金=自己拿主意 / 冷银=为别人期待 / 灰蓝=枯枝
7. 攒够 2 段语音后，未来的自己用**你自己的声音**开口（本地复刻，声纹不出机）
8. 红线守门：求建议/求预言的问题树会交还（"树不替你答"）；敏感话题熔断提示找信任的大人

## 演示 / 分享

- **现场演示**：本机三进程全跑（声纹复刻是现场版独占亮点）
- **传看**：录屏 2-3 分钟（含声音），黑客松最稳妥
- **评审自己动手**：部署 web + server 到任意服务器即可（web 静态托管 + node + DEEPSEEK key）。
  不带 sidecar 时"未来的自己"静默为纯文字——这是刻意的隐私设计，不是故障
- **分发文件夹**：务必排除 `server/.env`（含 LLM key）；模型需按上文步骤在线拉取

## 测试

```bash
pnpm --filter @oasis/shared test   # 树拓扑纯函数
pnpm --filter @oasis/web test      # 世界引擎状态机（触发节奏/终局/枯枝/继续）
```

## 数据红线

- 原始音频即取即弃；声纹素材仅存本地 sidecar，离开页面自动清除（sendBeacon → DELETE /refs）
- 声纹不出机：不克隆孩子的声音；复刻仅限进入时知情同意的演示者本人
- 转写文本匿名化 + 会话隔离 + `DELETE /api/session/:id` 一键清除
- LLM 调用全部走服务端；替身声线零容忍（未复刻即静默）
