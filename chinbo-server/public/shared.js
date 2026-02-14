(function () {
  function escapeHTML(v = '') {
    return String(v)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message, timeout = 1800) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), timeout);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copiado al portapapeles');
    } catch {
      showToast('No se pudo copiar');
    }
  }

  function createSimpleButtonsHTML(button) {
    return `<button class="employee-btn" data-action="copy" data-text="${escapeHTML(button.text || '')}">${escapeHTML(button.label || 'Botón')}</button>`;
  }

  function createFlipHTML(button) {
    const id = button.id || `flip_${Math.random().toString(36).slice(2)}`;
    return `
      <div class="flip-card" data-flip-id="${escapeHTML(id)}">
        <div class="flip-inner">
          <div class="flip-face">${escapeHTML(button.front || button.label || 'Front')}</div>
          <div class="flip-face flip-back">${escapeHTML(button.back || 'Back')}</div>
        </div>
      </div>
    `;
  }

  function createRevinHTML(button) {
    const values = Array.isArray(button.values) ? button.values : ['OK', 'Pendiente', 'Error'];
    return `
      <div class="card" data-revin-id="${escapeHTML(button.id || '')}">
        <div><strong>${escapeHTML(button.label || 'Revin')}</strong></div>
        <div class="row" style="margin-top:8px;">
          ${values.map((value) => `<button data-action="revin" data-value="${escapeHTML(value)}">${escapeHTML(value)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function handleRevinAction(value) {
    showToast(`Revin: ${value}`);
  }

  function attachEmployeeViewListeners(container) {
    container.addEventListener('click', (event) => {
      const copyBtn = event.target.closest('[data-action="copy"]');
      if (copyBtn) {
        copyText(copyBtn.dataset.text || '');
      }

      const revinBtn = event.target.closest('[data-action="revin"]');
      if (revinBtn) {
        handleRevinAction(revinBtn.dataset.value || '');
      }

      const flip = event.target.closest('.flip-card');
      if (flip) {
        const inner = flip.querySelector('.flip-inner');
        inner.classList.toggle('flipped');
      }
    });
  }

  function renderEmployeeView(containerId, config) {
    const container = document.getElementById(containerId);
    const groups = config?.groups || [];
    container.innerHTML = groups.map((group) => {
      return `
        <section class="panel">
          <h3 class="group-title">${escapeHTML(group.name || 'Grupo')}</h3>
          <div class="grid">
            ${(group.buttons || []).map((button) => {
              if (button.type === 'flip') return createFlipHTML(button);
              if (button.type === 'revin') return createRevinHTML(button);
              return createSimpleButtonsHTML(button);
            }).join('')}
          </div>
        </section>
      `;
    }).join('');

    attachEmployeeViewListeners(container);
  }

  window.ChinboShared = {
    escapeHTML,
    showToast,
    copyText,
    createSimpleButtonsHTML,
    createFlipHTML,
    createRevinHTML,
    handleRevinAction,
    renderEmployeeView,
    attachEmployeeViewListeners
  };
})();
