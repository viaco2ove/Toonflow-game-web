export type ModelConfigKind = "text" | "image" | "voice" | "voice_design" | "voice_clone";

export interface ManufacturerOption {
  value: string;
  label: string;
  website?: string;
  defaults: Partial<Record<ModelConfigKind, string>>;
}

export interface ModelTypeOption {
  value: string;
  label: string;
}

export const MODEL_MANUFACTURERS: ManufacturerOption[] = [
  {
    value: "volcengine",
    label: "火山引擎",
    website: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    defaults: {
      text: "https://ark.cn-beijing.volces.com/api/v3",
      image: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    },
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    website: "https://platform.deepseek.com",
    defaults: {
      text: "https://api.deepseek.com/v1",
    },
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    website: "https://lmstudio.ai",
    defaults: {
      text: "http://127.0.0.1:1234/v1",
    },
  },
  {
    value: "autodl_chat",
    label: "AutoDL",
    website: "https://www.autodl.art/docs/DeepSeek-V3.2/",
    defaults: {
      text: "https://www.autodl.art/api/v1",
    },
  },
  {
    value: "qwen060",
    label: "local文本模型",
    website: "https://www.modelscope.cn/models/Qwen/Qwen3-0.6B",
    defaults: {
      text: "http://127.0.0.1:11434/v1",
    },
  },
  {
    value: "openai",
    label: "OpenAI",
    defaults: {
      text: "https://api.openai.com/v1",
      image: "https://api.openai.com/v1/images/generations",
    },
  },
  {
    value: "gemini",
    label: "Gemini",
    website: "https://ai.google.dev/gemini-api/docs/api-key?hl=zh-cn",
    defaults: {
      text: "https://generativelanguage.googleapis.com/v1beta",
      image: "https://generativelanguage.googleapis.com/v1beta",
    },
  },
  {
    value: "bria",
    label: "Bria",
    website: "https://platform.bria.ai",
    defaults: {
      image: "https://engine.prod.bria-api.com/v2/image/edit",
    },
  },
  {
    value: "aliyun_imageseg",
    label: "阿里云视觉",
    website: "https://ram.console.aliyun.com/manage/ak",
    defaults: {
      image: "https://imageseg.cn-shanghai.aliyuncs.com",
    },
  },
  {
    value: "tencent_ci",
    label: "腾讯云数据万象",
    website: "https://console.cloud.tencent.com/cam/capi",
    defaults: {},
  },
  {
    value: "local_birefnet",
    label: "BiRefNet 本地",
    website: "https://github.com/ZhengPeng7/BiRefNet",
    defaults: {},
  },
  {
    value: "local_modnet",
    label: "MODNet 本地",
    website: "https://github.com/ZhengPeng7/BiRefNet",
    defaults: {},
  },
  {
    value: "t8star",
    label: "t8star",
    defaults: {
      text: "https://ai.t8star.cn/v1",
      image: "https://ai.t8star.cn/v1/images/generations",
    },
  },
  {
    value: "zhipu",
    label: "智谱",
    website: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    defaults: {
      text: "https://open.bigmodel.cn/api/paas/v4",
    },
  },
  {
    value: "aliyun_direct",
    label: "阿里百炼",
    website: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key",
    defaults: {
      text: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      voice: "https://dashscope.aliyuncs.com",
      voice_design: "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
      voice_clone: "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
    },
  },
  {
    value: "minimax",
    label: "MiniMax",
    website: "https://platform.minimaxi.com",
    defaults: {
      voice: "https://api.minimaxi.com",
      voice_design: "https://api.minimaxi.com",
      voice_clone: "https://api.minimaxi.com",
    },
  },
  {
    value: "siliconflow",
    label: "硅基流动 SiliconFlow",
    website: "https://api-docs.siliconflow.cn",
    defaults: {
      voice: "https://api.siliconflow.cn",
      voice_clone: "https://api.siliconflow.cn",
    },
  },
  {
    value: "xiaomimimo",
    label: "小米 MiMo",
    website: "https://platform.xiaomimimo.com/console/api-keys",
    defaults: {
      voice: "https://api.xiaomimimo.com",
      voice_design: "https://api.xiaomimimo.com",
      voice_clone: "https://api.xiaomimimo.com",
    },
  },
  {
    value: "ai_voice_tts",
    label: "local CosyVoice(ai_voice_tts)",
    website: "https://github.com/viaco2ove/ai_voice_tts",
    defaults: {
      voice: "http://127.0.0.1:8000",
      voice_clone: "http://127.0.0.1:8000",
    },
  },
  {
    value: "moss_tts_nano",
    label: "MOSS-TTS-Nano 本地",
    website: "https://github.com/OpenMOSS/MOSS-TTS-Nano",
    defaults: {
      voice: "http://127.0.0.1:18083",
      voice_clone: "http://127.0.0.1:18083",
    },
  },
  {
    value: "other",
    label: "其他",
    defaults: {},
  },
];

export const MODEL_TYPE_OPTIONS: Record<ModelConfigKind, ModelTypeOption[]> = {
  text: [
    { value: "text", label: "通用文本" },
    { value: "deepThinkingText", label: "深度思考" },
  ],
  image: [
    { value: "t2i", label: "文生图" },
    { value: "i2i", label: "图生图" },
  ],
  voice: [
    { value: "tts", label: "语音合成" },
    { value: "asr", label: "语音识别" },
  ],
  voice_design: [
    { value: "voice_design", label: "语音设计" },
  ],
  voice_clone: [
    { value: "voice_clone", label: "语音克隆" },
  ],
};

export function modelKindLabel(type: string): string {
  if (type === "text") return "文本模型";
  if (type === "image") return "图像模型";
  if (type === "voice") return "语音模型";
  if (type === "voice_design") return "语音设计模型";
  if (type === "voice_clone") return "语音克隆模型";
  return "未知模型";
}

export function defaultModelTypeFor(type: ModelConfigKind): string {
  return MODEL_TYPE_OPTIONS[type][0]?.value || "";
}

export function defaultManufacturerFor(type: ModelConfigKind): string {
  if (type === "voice_design") return "aliyun_direct";
  if (type === "voice_clone") return "minimax";
  return type === "voice" ? "ai_voice_tts" : "volcengine";
}

export function defaultBaseUrlFor(
  manufacturer: string,
  type: ModelConfigKind,
  modelType = defaultModelTypeFor(type),
): string {
  if (type === "voice_design" && manufacturer === "aliyun_direct") {
    return "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
  }
  if (type === "voice_design" && manufacturer === "minimax") {
    return "https://api.minimaxi.com";
  }
  if (type === "voice_clone" && manufacturer === "aliyun_direct") {
    return "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
  }
  if (type === "voice_clone" && manufacturer === "minimax") {
    return "https://api.minimaxi.com";
  }
  if ((type === "voice_clone" || type === "voice") && manufacturer === "siliconflow") {
    return "https://api.siliconflow.cn";
  }
  if (type === "voice_clone" && manufacturer === "ai_voice_tts") {
    return "http://127.0.0.1:8000";
  }
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return modelType === "asr"
      ? "https://dashscope.aliyuncs.com/compatible-mode"
      : "https://dashscope.aliyuncs.com";
  }
  if (type === "voice" && manufacturer === "ai_voice_tts") {
    return "http://127.0.0.1:8000";
  }
  return MODEL_MANUFACTURERS.find((item) => item.value === manufacturer)?.defaults[type] || "";
}

export function defaultModelNameFor(manufacturer: string, type: ModelConfigKind, modelType = defaultModelTypeFor(type)): string {
  if (type === "text" && manufacturer === "volcengine") {
    return "doubao-seed-2-0-lite-260215";
  }
  if (type === "text" && manufacturer === "autodl_chat") {
    return "DeepSeek-R1-0528";
  }
  if (type === "text" && manufacturer === "deepseek") {
    return "deepseek-chat";
  }
  if (type === "text" && manufacturer === "lmstudio") {
    return "qwen3.5-9b";
  }

  // 语音设计模型
  if (type === "voice_design" && manufacturer === "aliyun_direct") {
    return "qwen3-tts-vd-2026-01-26";
  }
  if (type === "voice_design" && manufacturer === "minimax") {
    return "voice-design";
  }
  if (type === "voice_design" && manufacturer === "xiaomimimo") {
    return "mimo-v2.5-tts-voicedesign";
  }

  // 语音克隆模型
  if (type === "voice_clone" && manufacturer === "aliyun_direct") {
    return "voice-enrollment";
  }
  if (type === "voice_clone" && manufacturer === "minimax") {
    return "speech-02-hd";
  }
  if (type === "voice_clone" && manufacturer === "ai_voice_tts") {
    return "clone_upload";
  }
  if (type === "voice_clone" && manufacturer === "xiaomimimo") {
    return "mimo-v2.5-tts-voiceclone";
  }

  // 语音合成模型
  if (type === "voice" && manufacturer === "ai_voice_tts") {
    return modelType === "tts" ? "ai_voice_tts" : "";
  }
  if (type === "voice" && manufacturer === "aliyun") {
    return modelType === "asr" ? "fun-asr-realtime" : "cosyvoice-v3-flash";
  }
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return modelType === "asr" ? "qwen3-asr-flash" : "cosyvoice-v3-flash";
  }
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return modelType === "asr" ? "qwen3-asr-flash" : "cosyvoice-v3-flash";
  }
  if (type === "voice" && manufacturer === "ai_voice_tts") {
    return modelType === "asr" ? "fun-asr-realtime" : "tts";
  }
  if (type === "voice" && manufacturer === "minimax") {
    return modelType === "tts" ? "speech-02-hd" : "";
  }
  if (type === "voice" && manufacturer === "xiaomimimo") {
    return modelType === "asr" ? "mimo-v2.5-asr" : "mimo-v2.5-tts";
  }

  // 图像模型
  if (type === "image" && manufacturer === "bria") {
    return "RMBG-2.0";
  }
  if (type === "image" && manufacturer === "aliyun_imageseg") {
    return "SegmentCommonImage";
  }
  if (type === "image" && manufacturer === "tencent_ci") {
    return "AIPortraitMatting";
  }
  if (type === "image" && manufacturer === "local_birefnet") {
    return "birefnet-portrait";
  }
  if (type === "image" && manufacturer === "local_modnet") {
    return "modnet-photographic-portrait";
  }

  return "";
}

export function modelOptionsFor(manufacturer: string, type: ModelConfigKind): { value: string; label: string }[] {
  // 语音设计模型选项
  if (type === "voice_design") {
    if (manufacturer === "aliyun_direct") {
      return [
        { value: "qwen3-tts-vd-2026-01-26", label: "Qwen3 TTS VD (语音设计)" },
        { value: "cosyvoice-v3-plus", label: "CosyVoice V3 Plus" },
      ];
    }
    if (manufacturer === "minimax") {
      return [
        { value: "voice-design", label: "Voice Design (接口无模型参数)" },
      ];
    }
    if (manufacturer === "xiaomimimo") {
      return [
        { value: "mimo-v2.5-tts-voicedesign", label: "MiMo V2.5 TTS Voice Design" },
      ];
    }
    if (manufacturer === "moss_tts_nano") {
      return [
        { value: "moss-tts-nano-100m", label: "MOSS-TTS-Nano (本地推理)" },
      ];
    }
    if (manufacturer === "siliconflow") {
      return [
        { value: "FunAudioLLM/CosyVoice2-0.5B", label: "CosyVoice2 0.5B" },
        { value: "fnlp/MOSS-TTSD-v0.5", label: "MOSS-TTSD v0.5" },
      ];
    }
  }

  // 语音克隆模型选项
  if (type === "voice_clone") {
    if (manufacturer === "aliyun_direct") {
      return [
        { value: "voice-enrollment", label: "Voice Enrollment (CosyVoice 专属音色)" },
        { value: "qwen-voice-enrollment", label: "Qwen Voice Enrollment (Qwen3 TTS VC 专属音色)" },
      ];
    }
    if (manufacturer === "minimax") {
      return [
        { value: "speech-2.8-hd", label: "Speech 2.8 HD" },
        { value: "speech-2.8-turbo", label: "Speech 2.8 Turbo" },
        { value: "speech-2.6-hd", label: "Speech 2.6 HD" },
        { value: "speech-2.6-turbo", label: "Speech 2.6 Turbo" },
        { value: "speech-02-hd", label: "Speech 02 HD" },
        { value: "speech-02-turbo", label: "Speech 02 Turbo" },
        { value: "speech-01-hd", label: "Speech 01 HD" },
        { value: "speech-01-turbo", label: "Speech 01 Turbo" },
      ];
    }
    if (manufacturer === "ai_voice_tts") {
      return [
        { value: "clone_upload", label: "Clone Upload (本地克隆)" },
      ];
    }
    if (manufacturer === "moss_tts_nano") {
      return [
        { value: "moss-tts-nano-100m", label: "MOSS-TTS-Nano 100M (本地推理)" },
      ];
    }
    if (manufacturer === "siliconflow") {
      return [
        { value: "FunAudioLLM/CosyVoice2-0.5B", label: "CosyVoice2 0.5B" },
        { value: "nlp/MOSS-TTSD-v0.5", label: "MOSS-TTSD-v0.5(声音克隆)" },
      ];
    }
    if (manufacturer === "xiaomimimo") {
      return [
        { value: "mimo-v2.5-tts-voiceclone", label: "MiMo V2.5 TTS Voice Clone" },
      ];
    }
  }

  // 语音合成模型选项
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return [
      { value: "cosyvoice-v3-flash", label: "CosyVoice V3 Flash" },
      { value: "cosyvoice-v3-plus", label: "CosyVoice V3 Plus" },
      { value: "cosyvoice-v3.5-flash", label: "CosyVoice V3.5 Flash" },
      { value: "cosyvoice-v3.5-plus", label: "CosyVoice V3.5 Plus" },
      { value: "qwen-tts", label: "Qwen TTS" },
      { value: "qwen-tts-latest", label: "Qwen TTS Latest" },
      { value: "qwen3-asr-flash", label: "Qwen3 ASR Flash" },
    ];
  }
  if (type === "voice" && manufacturer === "ai_voice_tts") {
    return [
      { value: "tts", label: "TTS (语音合成)" },
      { value: "fun-asr-realtime", label: "Fun ASR Realtime (语音识别)" },
      { value: "clone_upload", label: "Clone Upload (语音克隆)" },
    ];
  }
  if (type === "voice" && manufacturer === "minimax") {
    return [
      { value: "speech-2.8-hd", label: "Speech 2.8 HD" },
      { value: "speech-2.8-turbo", label: "Speech 2.8 Turbo" },
      { value: "speech-2.6-hd", label: "Speech 2.6 HD" },
      { value: "speech-2.6-turbo", label: "Speech 2.6 Turbo" },
      { value: "speech-02-hd", label: "Speech 02 HD" },
      { value: "speech-02-turbo", label: "Speech 02 Turbo" },
      { value: "speech-01-hd", label: "Speech 01 HD" },
      { value: "speech-01-turbo", label: "Speech 01 Turbo" },
    ];
  }
  if (type === "voice" && manufacturer === "siliconflow") {
    return [
      { value: "FunAudioLLM/CosyVoice2-0.5B", label: "CosyVoice2 0.5B (TTS)" },
      { value: "fnlp/MOSS-TTSD-v0.5", label: "MOSS-TTSD v0.5 (TTS)" },
      { value: "FunAudioLLM/SenseVoiceSmall", label: "SenseVoice Small (ASR)" },
      { value: "TeleAI/TeleSpeechASR", label: "TeleSpeech ASR (ASR)" },
    ];
  }
  if (type === "voice" && manufacturer === "xiaomimimo") {
    return [
      { value: "mimo-v2.5-tts", label: "MiMo V2.5 TTS" },
      { value: "mimo-v2-tts", label: "MiMo V2 TTS" },
      { value: "mimo-v2.5-asr", label: "MiMo V2.5 ASR" },
    ];
  }

  return [];
}

export function isApiKeyRequiredFor(manufacturer: string, type: ModelConfigKind): boolean {
  if (type === "voice" && manufacturer === "ai_voice_tts") return false;
  if (type === "voice" && manufacturer === "moss_tts_nano") return false;
  if (type === "voice_clone" && manufacturer === "ai_voice_tts") return false;
  if (type === "voice_clone" && manufacturer === "moss_tts_nano") return false;
  if (type === "voice_design" && manufacturer === "moss_tts_nano") return false;
  // 本地文本模型不需要 API Key
  if (type === "text" && manufacturer === "qwen060") return false;
  if (type === "text" && manufacturer === "lmstudio") return false;
  return true;
}

export function manufacturerLabel(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.label || value || "未知厂商";
}

export function manufacturerWebsite(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.website || "";
}