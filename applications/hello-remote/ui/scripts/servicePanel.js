export function mountServicePanel(host, backend, target, isDisposed) {
  const refresh = host.querySelector("[data-service-refresh]");
  const status = host.querySelector("[data-service-status]");
  const facts = host.querySelector("[data-service-facts]");

  const setFact = (name, value) => {
    host.querySelector(`[data-service-${name}]`).textContent = value;
  };
  const show = (info) => {
    if (isDisposed()) return;
    setFact("unit", info.service);
    setFact("version", info.version);
    setFact("ports", portSummary(info.externalPort, info.internalPort));
    setFact("user", info.user);
    setFact("database", info.database);
    setFact("password", info.passwordConfigured ? "generated and configured" : "missing");
    status.textContent = info.message;
    facts.hidden = false;
  };
  const inspect = () => {
    refresh.disabled = true;
    status.textContent = "Calling the supervised service…";
    backend
      .call("service", target)
      .then(show)
      .catch((error) => {
        if (!isDisposed()) {
          facts.hidden = true;
          status.textContent = `Service inspection failed: ${error.message}`;
        }
      })
      .finally(() => {
        if (!isDisposed()) refresh.disabled = false;
      });
  };

  refresh.addEventListener("click", inspect);
  inspect();
  return () => refresh.removeEventListener("click", inspect);
}

export function portSummary(externalPort, internalPort) {
  if (!Number.isInteger(externalPort) || !Number.isInteger(internalPort)) {
    return "Unknown";
  }
  return `127.0.0.1:${externalPort} → container:${internalPort}/tcp`;
}
