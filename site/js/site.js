"use strict";
(function(){
  const b = document.getElementById("theme");
  // Clair par défaut, sombre si le navigateur le préfère ; un choix fait sur le
  // site l'emporte, et le <head> l'a déjà posé avant la première peinture.
  const estSombre = () => {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const sync = () => {
    if(!b) return;
    const nuit = estSombre();
    b.setAttribute("aria-checked", nuit ? "true" : "false");
    b.setAttribute("aria-label", nuit ? "Mode nuit activé" : "Mode jour activé");
  };
  if(b) b.addEventListener("click", () => {
    const suivant = estSombre() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", suivant);
    try{ localStorage.setItem("rentaloc.theme", suivant); }catch(e){}
    sync();
    document.dispatchEvent(new Event("theme"));
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sync);
  sync();
  document.querySelectorAll("a.mail").forEach(a => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; });
})();
