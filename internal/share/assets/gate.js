// Team passcode gate: sets the team cookie, then reloads.
document.getElementById("gate").onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: document.getElementById("pc").value }) });
  if (r.ok) location.reload();
  else document.getElementById("err").textContent = "Wrong passcode";
};
