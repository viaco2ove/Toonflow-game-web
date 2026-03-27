export interface StoryPromptMeta {
  code: string;
  agentLabel: string;
  tsLabel: string;
}

export const STORY_PROMPT_META: Record<string, StoryPromptMeta> = {
  "story-main": {
    code: "story-main",
    agentLabel: "story_main",
    tsLabel: "src/agents/story/main.ts",
  },
  "story-orchestrator": {
    code: "story-orchestrator",
    agentLabel: "story_orchestrator",
    tsLabel: "src/agents/story/orchestrator/index.ts",
  },
  "story-speaker": {
    code: "story-speaker",
    agentLabel: "story_speaker",
    tsLabel: "src/agents/story/speaker/index.ts",
  },
  "story-memory": {
    code: "story-memory",
    agentLabel: "memory_manager",
    tsLabel: "src/agents/story/memory_manager/index.ts",
  },
  "story-chapter": {
    code: "story-chapter",
    agentLabel: "chapter_judge",
    tsLabel: "src/agents/story/chapter_judge/index.ts",
  },
  "story-mini-game": {
    code: "story-mini-game",
    agentLabel: "mini_game_agent",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-safety": {
    code: "story-safety",
    agentLabel: "safety_agent",
    tsLabel: "src/agents/story/safety/index.ts",
  },
};

export function storyPromptMeta(code: string): StoryPromptMeta {
  return (
    STORY_PROMPT_META[code] || {
      code,
      agentLabel: code,
      tsLabel: "src/agents/story/unknown.ts",
    }
  );
}
