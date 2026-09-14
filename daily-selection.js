'use strict';
// Eligibility only: never grants approval, changes dates, rebuilds or publishes.
function readyForDay(posts, today, validate) {
  const ready = [], blocked = [], deferred = [];
  for (const post of posts) {
    if (post.status !== 'approved' || post.publishedMediaId || post.publishedAt) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date || '') || post.date > today) {
      deferred.push(post.id); continue;
    }
    try { validate(post); ready.push(post); }
    catch (error) { blocked.push({ id: post.id, reason: error.message }); }
  }
  return { ready, blocked, deferred };
}
module.exports = { readyForDay };
