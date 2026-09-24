-- Makes the existing "Recreation" knowledge article's hours explicit
-- (was vaguely "during permitted hours on Friday").
UPDATE knowledge_articles
SET content = 'Table tennis, pickleball and basketball — after work, and 5 PM Fridays.'
WHERE title = 'Recreation';
