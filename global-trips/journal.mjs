import { mountLedger } from './journal-ledger.mjs?v=20261012-r5';

async function load() {
  const journal = document.querySelector('#tripJournal');
  const ledger = document.querySelector('#tripLedger');
  if (!journal || !ledger) return;
  const read = async (url, json = false) => {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`无法读取 ${url} (${response.status})`);
    return json ? response.json() : response.text();
  };
  try {
    const trip = await read(document.body.dataset.tripSource, true);
    const config = trip.journal;
    const [story, view, data] = await Promise.all([
      read(config.content), read(config.ledgerView), read(config.ledger, true)
    ]);
    journal.innerHTML = story;
    document.dispatchEvent(new Event('trip-journal-ready'));
    ledger.innerHTML = view;
    mountLedger(ledger, data);
    const dialog = document.createElement('dialog');
    dialog.className = 'journal-lightbox';
    const close = document.createElement('button');
    close.textContent = '关闭大图';
    const image = document.createElement('img');
    const caption = document.createElement('p');
    dialog.append(close, image, caption);
    document.body.append(dialog);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    journal.querySelectorAll('img').forEach(img => {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', `查看大图：${img.alt}`);
      const open = () => {
        image.src = img.src;
        image.className = img.className;
        image.alt = img.alt;
        caption.textContent = img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt;
        dialog.showModal();
      };
      img.addEventListener('click', open);
      img.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
    const printStyle = document.createElement('style');
    printStyle.textContent = '@media print { #panel-memories, #panel-budget {display:block!important} #tripJournal img {break-inside:avoid} }';
    document.head.append(printStyle);
  } catch (error) {
    for (const root of [journal, ledger]) {
      root.replaceChildren();
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = '游记载入失败，请刷新重试。' + error.message;
      root.append(message);
    }
  }
}
load();
