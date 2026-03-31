# autodl平台的大模型
https://www.autodl.art/docs/DeepSeek-V3.2/

OpenAI 请求端点：https://www.autodl.art/api/v1/
`curl --location -g --request POST "https://www.autodl.art/api/v1/chat/completions" \
--header "Authorization: Bearer $API_KEY" \
--header "Content-Type: application/json" \
--data-raw '{
    "messages": [
        {
            "role": "user",
            "content": "您好！"
        }
    ],
    "model":"DeepSeek-R1-0528",
    "stream":true
}'`

model：DeepSeek-R1-0528,GLM-5,DeepSeek-V3.2,MiniMax-M2.7,MiniMax-M2.5,Qwen3.5-397B-A17B,Kimi-K2.5,gpt-5.4