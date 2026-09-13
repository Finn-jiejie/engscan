'use strict';

/* 生词本 UI：视图切换、列表、复习、导出 */

(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t) => window.speak && window.speak(t);

  let viewOpen = false;
  let reviewQueue = [];
  let reviewIndex = 0;
  let reviewShown = false;

  async function refreshBadge() {
    try {
      const items = await Vocab.all();
      const badge = $('vocabBadge');
      badge.hidden = !items.length;
      badge.textContent = items.length > 99 ? '99+' : items.length;
    } catch {
      /* IndexedDB 不可用时静默 */
    }
  }

  async function refresh() {
    const items = (await Vocab.all()).sort((a, b) => b.addedAt - a.addedAt);
    const due = items.filter(Vocab.isDue);

    $('vocabStats').textContent = items.length
      ? `共 ${items.length} 个生词 · 今日待复习 ${due.length} 个`
      : '生词本还是空的——识别结果里点「＋」收藏单词。';

    $('btnReview').disabled = !due.length;
    $('btnExport').disabled = !items.length;

    const list = $('vocabList');
    list.innerHTML = '';
    items.forEach((it, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.animationDelay = Math.min(i, 8) * 0.04 + 's';
      card.innerHTML =
        `<div class="body">` +
        `<div><span class="word">${esc(it.word)}</span>` +
        (it.phonetic ? `<span class="ph">${esc(it.phonetic)}</span>` : '') +
        `</div>` +
        (it.meaning ? `<div class="mean">${esc(it.meaning)}</div>` : '') +
        `</div>` +
        `<button class="play" data-say="${esc(it.word)}" title="朗读">▸</button>` +
        `<button class="del" data-del="${esc(it.word)}" title="删除">✕</button>`;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-say]').forEach((b) => b.addEventListener('click', () => say(b.dataset.say)));
    list.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        await Vocab.del(b.dataset.del);
        refresh();
      })
    );

    refreshBadge();
  }

  /* ---------- 复习 ---------- */

  function renderReviewCard() {
    const area = $('reviewArea');
    if (reviewIndex >= reviewQueue.length) {
      area.innerHTML = '';
      refresh();
      setStatusText(`本轮复习完成：${reviewQueue.length} 个。`);
      return;
    }
    const it = reviewQueue[reviewIndex];
    reviewShown = false;
    area.innerHTML =
      `<div class="card review-card" style="animation-delay:0s">` +
      `<div class="body" style="text-align:center;padding:18px 0">` +
      `<div class="word" style="font-size:24px">${esc(it.word)}</div>` +
      `<div class="review-back hidden" id="reviewBack">` +
      (it.phonetic ? `<div class="ph" style="display:block;margin-top:8px">${esc(it.phonetic)}</div>` : '') +
      (it.meaning ? `<div class="mean" style="margin-top:8px">${esc(it.meaning)}</div>` : '') +
      `</div>` +
      `<div style="margin-top:14px"><button class="icon-btn" id="btnFlip">看答案</button></div>` +
      `</div>` +
      `<div class="review-btns hidden" id="reviewBtns">` +
      `<button class="ghost" data-r="0">忘了</button>` +
      `<button class="ghost solid" data-r="1">认识</button>` +
      `</div>` +
      `</div>`;

    $('btnFlip').addEventListener('click', () => {
      $('reviewBack').classList.remove('hidden');
      $('reviewBtns').classList.remove('hidden');
      $('btnFlip').classList.add('hidden');
      reviewShown = true;
      say(it.word);
    });
    area.querySelectorAll('[data-r]').forEach((b) =>
      b.addEventListener('click', async () => {
        await Vocab.review(it.word, b.dataset.r === '1');
        reviewIndex++;
        renderReviewCard();
      })
    );
  }

  async function startReview() {
    const items = await Vocab.all();
    reviewQueue = items.filter(Vocab.isDue).sort((a, b) => a.box - b.box || a.addedAt - b.addedAt);
    reviewIndex = 0;
    if (!reviewQueue.length) {
      setStatusText('今日没有待复习的生词。');
      return;
    }
    setStatusText(`复习 ${reviewQueue.length} 个：先回忆，再点「看答案」。`);
    renderReviewCard();
  }

  function setStatusText(t) {
    const el = $('status');
    el.textContent = t || '';
    el.className = 'status';
  }

  /* ---------- 事件 ---------- */

  let prevView = 'empty'; // 记住离开生词本时要回到哪个主视图

  function currentMainView() {
    if (!$('preview').classList.contains('hidden')) return 'preview';
    if (!$('result').classList.contains('hidden')) return 'result';
    return 'empty';
  }

  $('btnVocab').addEventListener('click', async () => {
    viewOpen = !viewOpen;
    const views = ['empty', 'preview', 'result', 'settings'];
    if (viewOpen) {
      prevView = currentMainView();
      views.forEach((id) => $(id).classList.add('hidden'));
      $('vocabView').classList.remove('hidden');
      await refresh();
    } else {
      $('vocabView').classList.add('hidden');
      views.forEach((id) => $(id).classList.add('hidden'));
      $(prevView).classList.remove('hidden');
    }
  });

  $('btnReview').addEventListener('click', startReview);
  $('btnExport').addEventListener('click', async () => {
    const items = await Vocab.all();
    if (items.length) Vocab.downloadCSV(items);
  });

  refreshBadge();

  document.addEventListener('vocab-changed', () => {
    if (viewOpen) refresh();
    else refreshBadge();
  });
})();
