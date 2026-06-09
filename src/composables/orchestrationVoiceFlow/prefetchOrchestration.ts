/**
 * 预取 orchestration 数据，当前轮获取完台词后，获取下一轮的角色编排数据：那个角色，什么说话动机
 * 等到streamlinesSteamGen.ts voiceGenPlay.ts 都认为当当前轮台词播放完毕后，
 * resolveSessionOrchestration.ts 正式进行角色编排行为，生成下一轮的台词。
 */