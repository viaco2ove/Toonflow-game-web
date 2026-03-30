export type ModelConfigKind = "text" | "image" | "voice" | "voice_design";

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
    value: "ai_voice_tts",
    label: "ai_voice_tts",
    website: "https://github.com/viaco2ove/ai_voice_tts",
    defaults: {
      voice: "http://127.0.0.1:8000",
    },
  },
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
    value: "qwen",
    label: "阿里千问",
    website: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key",
    defaults: {
      text: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      voice_design: "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
    },
  },
  {
    value: "aliyun",
    label: "local阿里云",
    website: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key",
    defaults: {
      voice: "http://127.0.0.1:8000",
    },
  },
  {
    value: "aliyun_direct",
    label: "阿里云直连",
    website: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key",
    defaults: {
      voice: "https://dashscope.aliyuncs.com",
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
    { value: "tts", label: "语音tts" },
    { value: "asr", label: "语音识别" },
  ],
  voice_design: [
    { value: "voice_design", label: "语音设计" },
  ],
};

export function modelKindLabel(type: string): string {
  if (type === "text") return "文本模型";
  if (type === "image") return "图像模型";
  if (type === "voice") return "语音模型";
  if (type === "voice_design") return "语音设计模型";
  return "未知模型";
}

export function defaultModelTypeFor(type: ModelConfigKind): string {
  return MODEL_TYPE_OPTIONS[type][0]?.value || "";
}

export function defaultManufacturerFor(type: ModelConfigKind): string {
  if (type === "voice_design") return "qwen";
  return type === "voice" ? "ai_voice_tts" : "volcengine";
}

export function defaultBaseUrlFor(
  manufacturer: string,
  type: ModelConfigKind,
  modelType = defaultModelTypeFor(type),
): string {
  if (type === "voice_design" && manufacturer === "qwen") {
    return "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
  }
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return modelType === "asr"
      ? "https://dashscope.aliyuncs.com/compatible-mode"
      : "https://dashscope.aliyuncs.com";
  }
  return MODEL_MANUFACTURERS.find((item) => item.value === manufacturer)?.defaults[type] || "";
}

export function defaultModelNameFor(manufacturer: string, type: ModelConfigKind, modelType = defaultModelTypeFor(type)): string {
  if (type === "text" && manufacturer === "volcengine") {
    return "doubao-seed-2-0-lite-260215";
  }
  if (type === "text" && manufacturer === "deepseek") {
    return "deepseek-chat";
  }
  if (type === "text" && manufacturer === "lmstudio") {
    return "qwen3.5-9b";
  }
  if (type === "voice_design" && manufacturer === "qwen") {
    return "qwen3-tts-vd-2026-01-26";
  }
  if (type === "voice" && manufacturer === "ai_voice_tts") {
    return modelType === "tts" ? "ai_voice_tts" : "";
  }
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
  if (type === "voice" && manufacturer === "aliyun") {
    return modelType === "asr" ? "fun-asr-realtime" : "cosyvoice-v3-flash";
  }
  if (type === "voice" && manufacturer === "aliyun_direct") {
    return modelType === "asr" ? "qwen3-asr-flash" : "cosyvoice-v3-flash";
  }
  return "";
}

export function isApiKeyRequiredFor(manufacturer: string, type: ModelConfigKind): boolean {
  if (type === "voice" && manufacturer === "ai_voice_tts") return false;
  if (type === "text" && manufacturer === "lmstudio") return false;
  if (type === "image" && manufacturer === "local_birefnet") return false;
  return true;
}

export function manufacturerLabel(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.label || value || "未知厂商";
}

export function manufacturerWebsite(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.website || "";
}
