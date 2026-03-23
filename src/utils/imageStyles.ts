export interface ImageStylePreset {
  key: string;
  title: string;
  subtitle: string;
  promptHint: string;
  accent: string;
  colors: string[];
}

export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = [
  { key: "general_3", title: "通用 3.0", subtitle: "高质角色", promptHint: "高质量角色立绘，五官清晰，光影干净，完整上半身", accent: "#6B55A2", colors: ["#EDE4FF", "#D8C8FF"] },
  { key: "general_1", title: "通用 1.0", subtitle: "自然真实", promptHint: "自然真实风格，清晰人物主体，干净背景，细节完整", accent: "#4E7DBD", colors: ["#DFF0FF", "#BFD8FF"] },
  { key: "romance", title: "言情漫画", subtitle: "二次元感", promptHint: "言情漫画风，精致五官，柔和上色，清透皮肤，甜美氛围", accent: "#FF7A98", colors: ["#FFE2EC", "#FFC2D3"] },
  { key: "pixel", title: "像素画", subtitle: "游戏像素", promptHint: "像素风角色，游戏感强，像素颗粒清晰，配色明快", accent: "#5BA86E", colors: ["#DFF7E6", "#BDECCB"] },
  { key: "thick", title: "细腻厚涂", subtitle: "厚涂质感", promptHint: "细腻厚涂，层次丰富，皮肤与布料质感明显，光影立体", accent: "#B26C3F", colors: ["#FFE8D8", "#FFD0A8"] },
  { key: "guofeng", title: "国风", subtitle: "东方审美", promptHint: "国风角色，东方审美，服饰纹样精致，气质端庄", accent: "#C0732A", colors: ["#FFF0D9", "#F7D79D"] },
  { key: "cinema", title: "电影感", subtitle: "大片构图", promptHint: "电影感构图，真实光影，景深明显，人物表情细腻", accent: "#365B8C", colors: ["#D6E6FF", "#B8C9E8"] },
  { key: "dark", title: "暗黑写实", subtitle: "强对比", promptHint: "暗黑写实风，强对比光影，气氛感强，角色轮廓锐利", accent: "#4B5568", colors: ["#DCE2EC", "#B6C0CF"] },
];

export function imageStyleForKey(key: string): ImageStylePreset {
  return IMAGE_STYLE_PRESETS.find((item) => item.key === key) || IMAGE_STYLE_PRESETS[0];
}
