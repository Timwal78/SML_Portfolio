(function() {
  'use strict';

  window.AgentCard = window.AgentCard || {};

  /**
   * Opens an accessible modal dialog for hiring an agent via x402.
   *
   * @param {string} agentSlug      - The agent's slug (e.g. "my-coder-agent")
   * @param {string} capabilityId   - The capability to hire (e.g. "coding.python")
   * @param {Object} [options]      - Optional overrides
   * @param {string} [options.label] - Override the modal heading text
   */
  AgentCard.hire = function(agentSlug, capabilityId, options) {
    options = options || {};

    var profileUrl = 'https://agentcard.io/a/' + encodeURIComponent(agentSlug)
                     + '?capability=' + encodeURIComponent(capabilityId);

    // Remove any existing hire modals
    var existing = document.getElementById('agentcard-hire-modal');
    if (existing) { existing.remove(); }

    // ---- Overlay ---------------------------------------------------------
    var overlay = document.createElement('div');
    overlay.id = 'agentcard-hire-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'agentcard-hire-title');
    overlay.setAttribute('aria-describedby', 'agentcard-hire-desc');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,.85)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:99999',
      'font-family:ui-monospace,"JetBrains Mono",Menlo,monospace',
      'padding:16px'
    ].join(';');

    // ---- Panel -----------------------------------------------------------
    var panel = document.createElement('div');
    panel.style.cssText = [
      'background:#0d0d0d',
      'border:1px solid #2a2a2a',
      'border-radius:12px',
      'padding:32px',
      'max-width:480px',
      'width:100%',
      'color:#e8e8e8',
      'position:relative'
    ].join(';');

    // ---- Close button (top-right) ----------------------------------------
    var closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close hire dialog');
    closeBtn.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:16px',
      'background:transparent',
      'border:none',
      'color:#888',
      'font-size:20px',
      'cursor:pointer',
      'line-height:1',
      'padding:4px 8px'
    ].join(';');
    closeBtn.textContent = '×';

    // ---- Heading ---------------------------------------------------------
    var heading = document.createElement('h2');
    heading.id = 'agentcard-hire-title';
    heading.style.cssText = 'margin:0 0 8px;font-size:18px;font-weight:700;padding-right:32px;';
    heading.textContent = options.label || ('Hire ' + agentSlug);

    // ---- Description -----------------------------------------------------
    var desc = document.createElement('p');
    desc.id = 'agentcard-hire-desc';
    desc.style.cssText = 'color:#888;font-size:13px;margin:0 0 24px;line-height:1.5;';
    desc.textContent = 'Capability: ' + capabilityId
                       + ' — Payment handled via x402 on Base network (USDC).';

    // ---- Primary CTA -----------------------------------------------------
    var ctaLink = document.createElement('a');
    ctaLink.href = profileUrl;
    ctaLink.target = '_blank';
    ctaLink.rel = 'noopener noreferrer';
    ctaLink.setAttribute('aria-label', 'Open AgentCard to hire this agent (opens in new tab)');
    ctaLink.style.cssText = [
      'display:block',
      'text-align:center',
      'padding:12px',
      'background:#00ff88',
      'color:#000',
      'border-radius:6px',
      'text-decoration:none',
      'font-weight:700',
      'font-size:14px',
      'transition:opacity .15s ease'
    ].join(';');
    ctaLink.textContent = '⚡ Hire via AgentCard';
    ctaLink.addEventListener('mouseover', function() { this.style.opacity = '0.88'; });
    ctaLink.addEventListener('mouseout',  function() { this.style.opacity = '1'; });

    // ---- Cancel button ---------------------------------------------------
    var cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = [
      'display:block',
      'width:100%',
      'margin-top:12px',
      'padding:10px',
      'background:transparent',
      'border:1px solid #2a2a2a',
      'color:#888',
      'border-radius:6px',
      'cursor:pointer',
      'font-family:ui-monospace,Menlo,monospace',
      'font-size:13px',
      'transition:border-color .15s ease,color .15s ease'
    ].join(';');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel and close dialog');
    cancelBtn.addEventListener('mouseover', function() {
      this.style.borderColor = '#555';
      this.style.color = '#ccc';
    });
    cancelBtn.addEventListener('mouseout', function() {
      this.style.borderColor = '#2a2a2a';
      this.style.color = '#888';
    });

    // ---- Powered-by badge ------------------------------------------------
    var poweredBy = document.createElement('p');
    poweredBy.style.cssText = 'margin:20px 0 0;text-align:center;font-size:11px;color:#555;';
    poweredBy.innerHTML = '<a href="https://agentcard.io?ref=widget" target="_blank" rel="noopener noreferrer" style="color:#555;text-decoration:none;" aria-label="AgentCard homepage">'
                          + '<span style="color:#00ff88" aria-hidden="true">&#9679;</span> Powered by AgentCard'
                          + '</a>';

    // ---- Assemble --------------------------------------------------------
    panel.appendChild(closeBtn);
    panel.appendChild(heading);
    panel.appendChild(desc);
    panel.appendChild(ctaLink);
    panel.appendChild(cancelBtn);
    panel.appendChild(poweredBy);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // ---- Event handling --------------------------------------------------
    function close() {
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) {
        previouslyFocused.focus();
      }
    }

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);

    // Close on backdrop click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { close(); }
    });

    // Close on Escape key; trap Tab within modal
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        document.removeEventListener('keydown', handleKeydown);
        return;
      }
      if (e.key === 'Tab') {
        var focusable = panel.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        );
        var first = focusable[0];
        var last  = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeydown);

    // Remove listener when overlay is removed
    var observer = new MutationObserver(function() {
      if (!document.getElementById('agentcard-hire-modal')) {
        document.removeEventListener('keydown', handleKeydown);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });

    // ---- Focus management -----------------------------------------------
    var previouslyFocused = document.activeElement;
    closeBtn.focus();
  };
})();
