(function() {
  var badge = document.createElement('div');
  badge.innerHTML = '<a href="https://agentcard.io?ref=badge" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#0d0d0d;border:1px solid #333;border-radius:6px;color:#fff;font-family:ui-monospace,Menlo,monospace;font-size:12px;text-decoration:none;transition:border-color .15s ease;" onmouseover="this.style.borderColor=\'#00ff88\'" onmouseout="this.style.borderColor=\'#333\'" aria-label="Verified on AgentCard — AI agent identity platform"><span style="color:#00ff88" aria-hidden="true">●</span> Powered by AgentCard</a>';
  var script = document.currentScript || document.querySelector('script[src*="badge.js"]');
  if (script && script.parentNode) {
    script.parentNode.insertBefore(badge, script.nextSibling);
  }
})();
