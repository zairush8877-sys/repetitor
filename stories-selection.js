'use strict';

// Pure selection: rendering, approval and publication are separate actions.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/;

function moscowDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function validDate(value) {
  if (!DATE.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function hasUnknownDelivery(story) {
  return (story.delivery?.parts || []).some(part => ['publishing', 'unknown'].includes(part?.state));
}

function selectStory(bank, { today = moscowDate(), onlyId } = {}) {
  if (!validDate(today)) throw new Error('Нужна действительная дата YYYY-MM-DD.');
  const stories = bank.stories || [];
  const seen = new Set();
  for (const story of stories) {
    if (!ID.test(story.id || '') || seen.has(story.id)) throw new Error(`Некорректный или повторный ID Stories: ${story.id}`);
    seen.add(story.id);
  }
  const unknown = stories.find(hasUnknownDelivery);
  if (unknown) return { story: null, reason: 'unknown-delivery', detail: `У ${unknown.id} неизвестный исход отправки. Сначала сверить Instagram; повтор заблокирован.` };
  if (onlyId && !stories.some(story => story.id === onlyId)) {
    return { story: null, reason: 'not-found', detail: `Stories ${onlyId} нет в банке.` };
  }
  const eligible = story => story.status === 'approved' && !story.publishedAt &&
    (!story.date || (validDate(story.date) && story.date <= today));
  const partial = stories.find(story => eligible(story) && story.publishedMediaIds?.some(Boolean));
  const todayPublished = stories.find(story => story.publishedAt && moscowDate(story.publishedAt) === today);
  if (todayPublished) return { story: null, reason: 'already-published-today', detail: `Сегодня уже вышла ${todayPublished.id}; второй комплект не отправляется.` };
  if (partial && onlyId && onlyId !== partial.id) {
    return { story: null, reason: 'partial-delivery', detail: `Сначала завершить комплект ${partial.id}; его подтверждённые части не повторять.` };
  }
  const story = partial || (onlyId ? stories.find(item => item.id === onlyId && eligible(item)) : stories.find(eligible));
  if (!story) {
    const unapproved = stories.filter(item => !['published', 'rejected'].includes(item.status)).length;
    return { story: null, reason: 'no-approved-story', detail: unapproved
      ? 'Нет одобренной Stories на сегодня. Черновики и будущие даты не публикуются.'
      : 'Банк самостоятельных Stories исчерпан. Нужен новый проверенный материал.' };
  }
  return { story, reason: 'selected', detail: `Выбран комплект ${story.id}: вопрос и ответ.` };
}

module.exports = { moscowDate, validDate, selectStory, hasUnknownDelivery, ID };
