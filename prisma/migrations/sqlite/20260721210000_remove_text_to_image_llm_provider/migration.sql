-- Route B hard cut: Agent Runtime owns Director LLM；文生图 Provider 只允许 NovelAI singleton。
DELETE FROM "TextToImageProvider"
WHERE "kind" <> 'novelai';

UPDATE "TextToImageProvider"
SET "model" = NULL
WHERE "kind" = 'novelai';
