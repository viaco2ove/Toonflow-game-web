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
  "story-orchestrator-compact": {
    code: "story-orchestrator-compact",
    agentLabel: "story_orchestrator_compact",
    tsLabel: "src/agents/story/orchestrator/index.ts",
  },
  "story-orchestrator-advanced": {
    code: "story-orchestrator-advanced",
    agentLabel: "story_orchestrator_advanced",
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
  "story-event-progress": {
    code: "story-event-progress",
    agentLabel: "event_progress",
    tsLabel: "src/agents/story/event_progress/index.ts",
  },
  "story-mini-game": {
    code: "story-mini-game",
    agentLabel: "mini_game_agent",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-battle": {
    code: "story-mini-game-battle",
    agentLabel: "mini_game_battle",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-fishing": {
    code: "story-mini-game-fishing",
    agentLabel: "mini_game_fishing",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-werewolf": {
    code: "story-mini-game-werewolf",
    agentLabel: "mini_game_werewolf",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-cultivation": {
    code: "story-mini-game-cultivation",
    agentLabel: "mini_game_cultivation",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-mining": {
    code: "story-mini-game-mining",
    agentLabel: "mini_game_mining",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-research-skill": {
    code: "story-mini-game-research-skill",
    agentLabel: "mini_game_research_skill",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-alchemy": {
    code: "story-mini-game-alchemy",
    agentLabel: "mini_game_alchemy",
    tsLabel: "src/agents/story/mini_game/index.ts",
  },
  "story-mini-game-upgrade-equipment": {
    code: "story-mini-game-upgrade-equipment",
    agentLabel: "mini_game_upgrade_equipment",
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
