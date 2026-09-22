// Owns the shared async lifecycle for the container and service inspection
// panels: loading, disposal-safe completion, button state, and listener cleanup.
export function mountInspectionRefresh({
  refresh,
  isDisposed,
  load,
  onLoading,
  onSuccess,
  onFailure,
}) {
  const inspect = () => {
    refresh.disabled = true;
    onLoading();
    load()
      .then((value) => {
        if (!isDisposed()) onSuccess(value);
      })
      .catch((error) => {
        if (!isDisposed()) onFailure(error);
      })
      .finally(() => {
        if (!isDisposed()) refresh.disabled = false;
      });
  };

  refresh.addEventListener("click", inspect);
  inspect();
  return () => refresh.removeEventListener("click", inspect);
}
