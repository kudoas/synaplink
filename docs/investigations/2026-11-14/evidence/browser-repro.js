async (page) => {
  await page.addInitScript(() => {
    const makeNote = (id, title, body, modifiedAt) => ({
      id, title, body, modifiedAt, revision: `r-${id}`,
      links: body.includes('[[りんご]]') ? [{ displayName: 'りんご', normalizedName: 'りんご' }] : [],
    });
    window.__auditNotes = [
      makeNote('a.txt', '調査用メモ', '先頭の説明。\nここにだけ深部検索語があります。\n[[りんご]] と https://example.com', 2000),
      makeNote('b.txt', '別のメモ', '別の本文', 1000),
    ];
    window.__auditCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        window.__auditCalls.push({ cmd, args });
        if (cmd === 'get_vault') return '/tmp/synaplink-audit';
        if (cmd === 'list_notes') return window.__auditNotes.map(note => ({ ...note, preview: note.body.split('\n')[0].slice(0, 90) }));
        if (cmd === 'read_note') return structuredClone(window.__auditNotes.find(note => note.id === args.id));
        if (cmd === 'save_note') {
          if (window.__auditConflict) return { status: 'conflict', current: { ...window.__auditNotes[0], body: '外部の編集', revision: 'external' } };
          const note = window.__auditNotes.find(note => note.id === args.input.id);
          Object.assign(note, args.input, { revision: `${note.revision}x` });
          return { status: 'saved', note: structuredClone(note) };
        }
        if (cmd === 'create_note') {
          const note = makeNote('new.txt', '無題', '', 3000);
          window.__auditNotes.unshift(note);
          return note;
        }
        if (cmd === 'plugin:opener|open_url') throw Error('audit opener failure');
        throw Error(`unimplemented audit command ${cmd}`);
      },
    };
  });
  await page.goto('http://127.0.0.1:1420');
  await page.getByPlaceholder('メモを検索').fill('深部検索語');
  const search = { query: '深部検索語', visibleRows: await page.locator('.note-row').count(), message: await page.locator('.note-list').innerText() };
  if (search.visibleRows !== 0) throw Error('Search result differs from observation');
  await page.getByPlaceholder('メモを検索').fill('');
  await page.getByRole('button', { name: /調査用メモ/ }).click();
  await page.locator('.cm-zettel-link').click();
  await page.waitForFunction(() => window.__auditCalls.some(call => call.cmd === 'plugin:opener|open_url'));
  const opener = { calls: await page.evaluate(() => window.__auditCalls.filter(call => call.cmd === 'plugin:opener|open_url').length), errorToasts: await page.locator('.error-toast').count() };
  await page.getByRole('button', { name: /新しいメモ/ }).click();
  await page.getByLabel('タイトル').waitFor();
  const newNote = await page.evaluate(() => ({ activeClass: document.activeElement.className, title: document.querySelector('.title-input').value }));
  if (newNote.activeClass !== 'new-note-button') throw Error('New-note focus differs from observation');
  await page.reload();
  await page.getByRole('button', { name: /調査用メモ/ }).click();
  await page.locator('.cm-content').fill('折り返し表示を調べるための長い本文。'.repeat(40));
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === '保存済み');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  const wrappedLine = await page.evaluate(() => {
    const line = document.querySelector('.cm-line').getBoundingClientRect();
    const selection = getSelection();
    const range = selection.getRangeAt(0).getBoundingClientRect();
    return { lineHeight: line.height, caretOffsetFromTop: range.top - line.top, activeTag: document.activeElement.tagName };
  });
  if (wrappedLine.caretOffsetFromTop < 50) throw Error('Caret is not in a lower wrapped row');
  await page.keyboard.press('ArrowUp');
  const afterArrowUp = await page.evaluate(() => ({ tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label') }));
  if (afterArrowUp.label !== 'タイトル') throw Error('ArrowUp result differs from observation');
  await page.evaluate(() => { window.__auditConflict = true; });
  await page.locator('.cm-content').fill('ローカルの編集');
  await page.getByRole('dialog').waitFor();
  const conflict = await page.evaluate(() => ({ activeInsideDialog: document.querySelector('[role=dialog]').contains(document.activeElement), activeClass: document.activeElement.className }));
  const tabSequence = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Tab');
    tabSequence.push(await page.evaluate(() => ({ tag: document.activeElement.tagName, className: document.activeElement.className, insideDialog: document.querySelector('[role=dialog]').contains(document.activeElement), text: document.activeElement.tagName === 'BUTTON' ? document.activeElement.textContent : null })));
  }
  if (conflict.activeInsideDialog || tabSequence.every(step => step.insideDialog)) throw Error('Conflict focus result differs from observation');
  return { browserVersion: page.context().browser().version(), viewport: page.viewportSize(), search, opener, newNote, wrappedLine, afterArrowUp, conflict, tabSequence };
}
