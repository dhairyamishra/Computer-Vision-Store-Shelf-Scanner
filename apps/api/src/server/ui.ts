export const SHELF_AUDIT_UI = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shelf Audit</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #eef2ff; }
    * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 15% 0%, #1d3b63 0, transparent 32rem), #0b1020; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0; }
    .eyebrow { color: #7dd3fc; font-size: .78rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 630px; font-size: clamp(2.2rem, 7vw, 4.2rem); line-height: 1; letter-spacing: -.06em; margin: 14px 0; }
    .intro { color: #b9c5dc; font-size: 1.05rem; line-height: 1.65; max-width: 640px; }
    .card { background: rgba(18, 27, 49, .88); border: 1px solid #2c3b5a; border-radius: 20px; padding: 24px; margin-top: 32px; box-shadow: 0 28px 70px rgba(0,0,0,.22); }
    label { display: block; font-weight: 700; margin: 18px 0 8px; } select, input, button { font: inherit; } select { width: 100%; border: 1px solid #3b4b6d; border-radius: 10px; background: #101a2f; color: #eef2ff; padding: 13px; } input[type=file] { display: none; }
    .drop-zone { min-height: 180px; display: grid; place-content: center; gap: 10px; text-align: center; border: 2px dashed #4c638e; border-radius: 14px; padding: 28px; background: #101a2f; color: #c7d2fe; transition: .15s ease; } .drop-zone.dragging { border-color: #67e8f9; background: #15304a; } .drop-zone strong { color: #f8fafc; font-size: 1.1rem; } .browse { width: auto; margin: 4px auto 0; padding: 9px 15px; background: #273b60; color: #e8efff; } .browse:hover { background: #344d79; }
    .hint { margin: 8px 0 0; color: #93a4c2; font-size: .88rem; } button { width: 100%; margin-top: 24px; padding: 14px; border: 0; border-radius: 10px; background: #67e8f9; color: #082032; font-weight: 850; cursor: pointer; } button:hover { background: #a5f3fc; } button:disabled { opacity: .6; cursor: progress; }
    .preview { display: none; width: 100%; max-height: 260px; object-fit: contain; border-radius: 12px; margin-top: 16px; background: #060a13; } .preview.show { display: block; }
    #status { min-height: 1.5em; color: #b9c5dc; margin: 20px 0 0; } #result { display: none; margin-top: 24px; } #result.show { display:block; } pre { margin: 0; overflow: auto; padding: 18px; border-radius: 12px; background: #060a13; color: #c7d2fe; font-size: .83rem; line-height: 1.45; }
    .note { margin-top: 22px; color: #93a4c2; font-size: .86rem; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Field shelf audit</div>
    <h1>Point. Upload. Understand what the shelf can support.</h1>
    <p class="intro">Select an account, add a shelf photo or a short video, and submit it for a persisted, evidence-backed audit. Results state what the current analysis could and could not determine.</p>
    <section class="card" aria-label="Create an audit">
      <form id="audit-form">
        <label for="account">Account</label><select id="account" name="accountId" required><option>Loading accounts…</option></select>
        <label for="media">Shelf photo or video</label><input id="media" name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" />
        <div id="drop-zone" class="drop-zone" tabindex="0" aria-label="Drag media here or paste an image"><strong>Drag a shelf photo or video here</strong><span>or paste a copied image with Ctrl + V</span><button id="browse" class="browse" type="button">Browse files</button></div>
        <p class="hint">Photos are analyzed as one evidence frame. Videos may be up to two minutes.</p>
        <img id="image-preview" class="preview" alt="Selected shelf photo preview" />
        <button id="submit" type="submit">Submit for analysis</button>
      </form>
      <p id="status" role="status"></p>
      <section id="result" aria-label="Audit result"><label>Structured audit</label><pre id="output"></pre></section>
      <p class="note">Grok analyzes selected evidence frames against the account catalog. Findings remain empty when labels are not visually supported; set <code>XAI_API_KEY</code> locally to enable managed vision analysis.</p>
    </section>
  </main>
  <script>
    const form = document.querySelector('#audit-form'); const account = document.querySelector('#account'); const media = document.querySelector('#media'); const dropZone = document.querySelector('#drop-zone'); const browse = document.querySelector('#browse'); const status = document.querySelector('#status'); const submit = document.querySelector('#submit'); const result = document.querySelector('#result'); const output = document.querySelector('#output'); const preview = document.querySelector('#image-preview'); let selectedFile;
    async function loadAccounts() { const response = await fetch('/accounts'); const data = await response.json(); account.innerHTML = data.accounts.map(a => '<option value="' + a.id + '">' + a.name + ' · ' + a.region + '</option>').join(''); }
    function setMedia(file, source) { selectedFile = file; if (preview.src) URL.revokeObjectURL(preview.src); if (file && file.type.startsWith('image/')) { preview.src = URL.createObjectURL(file); preview.classList.add('show'); } else { preview.removeAttribute('src'); preview.classList.remove('show'); } status.textContent = file ? source + ': ' + file.name : ''; }
    media.addEventListener('change', () => setMedia(media.files[0], 'Selected'));
    browse.addEventListener('click', () => media.click());
    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
    dropZone.addEventListener('drop', event => { const file = [...event.dataTransfer.files].find(candidate => candidate.type.startsWith('image/') || candidate.type.startsWith('video/')); if (file) setMedia(file, 'Dropped'); else status.textContent = 'Drop a supported image or video file.'; });
    document.addEventListener('paste', event => { const item = [...event.clipboardData.items].find(candidate => candidate.type.startsWith('image/')); if (!item) return; const image = item.getAsFile(); if (!image) return; event.preventDefault(); setMedia(new File([image], 'pasted-shelf-image.' + (image.type.split('/')[1] || 'png'), { type: image.type }), 'Pasted image ready'); });
    form.addEventListener('submit', async event => { event.preventDefault(); const file = selectedFile || media.files[0]; if (!file) { status.textContent = 'Choose or paste a shelf photo or video first.'; return; } submit.disabled = true; result.classList.remove('show'); status.textContent = 'Uploading and analyzing your media…'; const payload = new FormData(); payload.append('accountId', account.value); payload.append('media', file); try { const created = await fetch('/audits', { method: 'POST', body: payload }); const createdData = await created.json(); if (!created.ok) throw new Error(createdData.error?.message || 'Unable to create audit.'); status.textContent = 'Analysis complete. Loading the persisted audit…'; const audit = await fetch('/audits/' + createdData.auditId); const auditData = await audit.json(); if (!audit.ok) throw new Error(auditData.error?.message || 'Unable to load audit.'); output.textContent = JSON.stringify(auditData.finalAudit, null, 2); result.classList.add('show'); status.textContent = 'Audit completed in ' + auditData.stageLatencies.totalMs + ' ms.'; } catch (error) { status.textContent = error.message; } finally { submit.disabled = false; } });
    loadAccounts().catch(() => { account.innerHTML = '<option>Unable to load accounts</option>'; status.textContent = 'Could not load account context.'; });
  </script>
</body>
</html>`;
