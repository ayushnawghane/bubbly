// localStorage-backed persistence: best score + daily play streak.

const KEY_BEST = 'bubbly.highScore';
const KEY_STREAK = 'bubbly.streak';
const KEY_LAST_PLAYED = 'bubbly.lastPlayedDate';

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local-timezone-agnostic enough for a streak
}

function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00');
  const b = new Date(bStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function getHighScore() {
  return Number(localStorage.getItem(KEY_BEST) || 0);
}

/** Returns true if this score is a new high score (and persists it). */
export function submitScore(score) {
  const best = getHighScore();
  if (score > best) {
    localStorage.setItem(KEY_BEST, String(score));
    return true;
  }
  return false;
}

/**
 * Call once per session start. Compares today's date to the last played
 * date: consecutive day -> streak+1, same day -> unchanged, gap -> reset to 1.
 * Returns the current streak count.
 */
export function touchDailyStreak() {
  const today = todayStr();
  const lastPlayed = localStorage.getItem(KEY_LAST_PLAYED);
  let streak = Number(localStorage.getItem(KEY_STREAK) || 0);

  if (!lastPlayed) {
    streak = 1;
  } else {
    const gap = daysBetween(lastPlayed, today);
    if (gap === 0) {
      // already played today, streak unchanged
    } else if (gap === 1) {
      streak += 1;
    } else {
      streak = 1;
    }
  }

  localStorage.setItem(KEY_STREAK, String(streak));
  localStorage.setItem(KEY_LAST_PLAYED, today);
  return streak;
}

export function getStreak() {
  return Number(localStorage.getItem(KEY_STREAK) || 0);
}
