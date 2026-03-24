export type ModelConfigKind = "text" | "image" | "voice";

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
    { value: "tts", label: "语音生成" },
    { value: "asr", label: "语音识别" },
  ],
};

export function modelKindLabel(type: string): string {
  if (type === "text") return "文本模型";
  if (type === "image") return "图像模型";
  if (type === "voice") return "语音模型";
  return "未知模型";
}

export function defaultModelTypeFor(type: ModelConfigKind): string {
  return MODEL_TYPE_OPTIONS[type][0]?.value || "";
}

export function defaultBaseUrlFor(manufacturer: string, type: ModelConfigKind): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === manufacturer)?.defaults[type] || "";
}

export function manufacturerLabel(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.label || value || "未知厂商";
}

export function manufacturerWebsite(value: string): string {
  return MODEL_MANUFACTURERS.find((item) => item.value === value)?.website || "";
}
