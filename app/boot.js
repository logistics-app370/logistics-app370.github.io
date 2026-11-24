/* Starts the app: signed in -> show the saved list instantly, then refresh. */
(function () {
  if (window.LogisticsApi) window.LogisticsApi.boot();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    });
  }
})();
