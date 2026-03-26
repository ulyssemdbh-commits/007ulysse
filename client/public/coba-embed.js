(function() {
  if (window.__cobaWidgetLoaded) return;
  window.__cobaWidgetLoaded = true;

  var config = window.COBAWidget || {};
  var apiUrl = config.apiUrl || '';
  var apiKey = config.apiKey || '';
  var tenantId = config.tenantId || '';
  var proUserId = config.proUserId || '';
  var proUserName = config.proUserName || '';
  var restaurantName = config.restaurantName || '';
  var position = config.position || 'bottom-right';
  var primaryColor = config.primaryColor || '#6366f1';

  var bubble = document.createElement('div');
  bubble.id = 'coba-bubble';
  bubble.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  bubble.style.cssText = 'position:fixed;' + (position === 'bottom-left' ? 'left:20px' : 'right:20px') + ';bottom:20px;width:56px;height:56px;border-radius:50%;background:' + primaryColor + ';display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:99999;transition:transform .2s';
  bubble.onmouseenter = function() { bubble.style.transform = 'scale(1.1)'; };
  bubble.onmouseleave = function() { bubble.style.transform = 'scale(1)'; };

  var container = document.createElement('div');
  container.id = 'coba-container';
  container.style.cssText = 'position:fixed;' + (position === 'bottom-left' ? 'left:20px' : 'right:20px') + ';bottom:86px;width:380px;height:560px;max-height:80vh;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.4);z-index:99999;display:none;opacity:0;transform:translateY(20px);transition:opacity .3s,transform .3s';

  var params = new URLSearchParams({
    tenant: tenantId,
    user: proUserId,
    name: proUserName,
    restaurant: restaurantName,
    key: apiKey
  });

  var iframe = document.createElement('iframe');
  iframe.src = apiUrl + '/coba-widget.html?' + params.toString();
  iframe.style.cssText = 'width:100%;height:100%;border:none';
  iframe.allow = 'clipboard-write';

  container.appendChild(iframe);

  var open = false;
  bubble.onclick = function() {
    open = !open;
    if (open) {
      container.style.display = 'block';
      requestAnimationFrame(function() {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      });
      bubble.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
      container.style.opacity = '0';
      container.style.transform = 'translateY(20px)';
      setTimeout(function() { container.style.display = 'none'; }, 300);
      bubble.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    }
  };

  document.body.appendChild(container);
  document.body.appendChild(bubble);
})();
