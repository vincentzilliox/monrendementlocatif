#!/usr/bin/env python3
"""Vérifie le site avant mise en ligne.

Reconstruit site/, le sert en local, puis contrôle ce qui casse en silence :
erreurs JavaScript, valeurs NaN, débordement horizontal, ressources manquantes,
appels vers un domaine tiers, balisage invalide, métadonnées hors normes.
Contrôle aussi le moteur financier, dont une erreur ne se voit pas à l'écran.

    python3 outils/verifier.py

Sortie : une ligne par contrôle, et un code de sortie non nul si l'un échoue.
"""

import http.server
import json
import pathlib
import re
import socket
import socketserver
import subprocess
import sys
import threading
import urllib.error
import urllib.request

RACINE = pathlib.Path(__file__).parent.parent
SITE = RACINE / "site"
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/usr/bin/google-chrome", "/usr/bin/chromium")
JSC = ("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc",)

resultats = []


def controle(nom, ok, detail=""):
    resultats.append(ok)
    print("  %s  %-46s %s" % ("OK  " if ok else "ECHEC", nom, detail))


def premier_existant(chemins):
    return next((c for c in chemins if pathlib.Path(c).exists()), None)


def servir():
    """Sert site/ sur un port libre, dans un thread de fond."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    classe = type("Handler", (http.server.SimpleHTTPRequestHandler,),
                  {"__init__": lambda self, *a, **k:
                   http.server.SimpleHTTPRequestHandler.__init__(
                       self, *a, directory=str(SITE), **k),
                   "log_message": lambda *a: None})
    serveur = socketserver.TCPServer(("127.0.0.1", port), classe)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    return serveur, "http://127.0.0.1:%d" % port


def sonde_navigateur(chrome, base):
    """Charge la page dans Chrome et rapatrie un diagnostic depuis le DOM."""
    sonde = """
<div id="sonde"></div>
<script>
window.__err=[]; window.addEventListener("error",function(e){window.__err.push(e.message);});
setTimeout(function(){
  var d=document.documentElement, r={};
  r.erreurs   = window.__err;
  r.suspects  = (document.body.innerText.match(/NaN|undefined|Infinity/g)||[]);
  r.deborde   = d.scrollWidth > d.clientWidth + 1;
  r.tuiles    = document.querySelectorAll(".tile").length;
  r.courbes   = document.querySelectorAll("#plotNet path[stroke]").length;
  r.lignes    = document.querySelectorAll("#tbl tbody tr").length;
  r.questions = document.querySelectorAll(".faq article").length;
  r.tri       = document.getElementById("heroTri").textContent;
  document.getElementById("sonde").textContent = "SONDE::" + JSON.stringify(r);
}, 1500);
</script>"""
    page = (SITE / "index.html").read_text(encoding="utf-8")
    temoin = SITE / "__verif.html"
    temoin.write_text(page.replace("</body>", sonde + "</body>"), encoding="utf-8")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=8000",
             "--window-size=1360,1000", "--dump-dom", base + "/__verif.html"],
            capture_output=True, text=True, timeout=90).stdout
        trouve = re.search(r"SONDE::(\{.*?\})</div>", dom, re.S)
        return json.loads(trouve.group(1)) if trouve else None
    finally:
        temoin.unlink(missing_ok=True)


def main():
    print("Construction…")
    subprocess.run([sys.executable, "build.py"], cwd=RACINE,
                   capture_output=True, check=True)

    serveur, base = servir()
    try:
        print("\nRESSOURCES")
        for chemin in ("/", "/css/style.css", "/js/app.js", "/favicon.ico",
                       "/assets/favicon.svg", "/assets/og-image.png",
                       "/assets/fonts/public-sans-400-latin.woff2",
                       "/robots.txt", "/sitemap.xml"):
            try:
                with urllib.request.urlopen(base + chemin, timeout=10) as r:
                    controle(chemin, r.status == 200, "%d o" % len(r.read()))
            except urllib.error.HTTPError as e:
                controle(chemin, False, "HTTP %d" % e.code)

        html = (SITE / "index.html").read_text(encoding="utf-8")
        css = (SITE / "css" / "style.css").read_text(encoding="utf-8")

        print("\nRÉFÉRENCEMENT")
        titre = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
        desc = re.search(r'name="description" content="(.*?)"', html, re.S).group(1)
        controle("titre sous 60 caractères", len(titre) <= 60, "%d" % len(titre))
        controle("description sous 160 caractères", len(desc) <= 160, "%d" % len(desc))
        controle("une seule balise h1", len(re.findall(r"<h1", html)) == 1)
        controle("image de partage déclarée", "og:image" in html)
        controle("langue déclarée", 'lang="fr"' in html)

        ld = json.loads(re.search(r'application/ld\+json">(.*?)</script>',
                                  html, re.S).group(1))
        types = [o["@type"] for o in ld] if isinstance(ld, list) else [ld["@type"]]
        controle("JSON-LD analysable", True, " + ".join(types))

        # Le balisage FAQ doit correspondre au texte affiché, sans quoi Google sanctionne.
        faq = next((o for o in ld if o.get("@type") == "FAQPage"), None) if isinstance(ld, list) else None
        if faq:
            visibles = re.findall(r"<h3>(.*?)</h3>", html, re.S)
            propre = lambda t: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)
                                      .replace("&nbsp;", " ")).strip()
            manquantes = [q["name"] for q in faq["mainEntity"]
                          if q["name"] not in [propre(v) for v in visibles]]
            controle("questions balisées toutes visibles", not manquantes,
                     "%d question(s)" % len(faq["mainEntity"]))

        print("\nCONFIDENTIALITÉ ET POIDS")
        tiers = {d for d in re.findall(r"https?://([a-z0-9.-]+)", html + css)
                 if not d.endswith(("w3.org", "schema.org", "sitemaps.org"))
                 and "monrendementlocatif" not in d}
        controle("aucun appel vers un domaine tiers", not tiers, ", ".join(tiers))
        poids = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
        controle("poids total sous 600 Ko", poids < 600_000, "%d Ko" % (poids // 1024))

        chrome = premier_existant(CHROME)
        if not chrome:
            print("\nNAVIGATEUR : Chrome introuvable, contrôles ignorés")
        else:
            print("\nNAVIGATEUR")
            r = sonde_navigateur(chrome, base)
            if r is None:
                controle("page chargée", False, "aucune réponse de la sonde")
            else:
                controle("aucune erreur JavaScript", not r["erreurs"],
                         "; ".join(r["erreurs"])[:60])
                controle("aucun NaN ni undefined affiché", not r["suspects"],
                         ", ".join(r["suspects"])[:40])
                controle("aucun débordement horizontal", not r["deborde"])
                controle("six tuiles d'indicateurs", r["tuiles"] == 6, str(r["tuiles"]))
                controle("quatre courbes comparées", r["courbes"] == 4, str(r["courbes"]))
                controle("tableau annuel rempli", r["lignes"] >= 10,
                         "%d lignes" % r["lignes"])
                controle("questions fréquentes présentes", r["questions"] >= 4,
                         "%d" % r["questions"])
                controle("rendement calculé", "%" in r["tri"], r["tri"])
    finally:
        serveur.shutdown()

    jsc = premier_existant(JSC)
    if not jsc:
        print("\nMOTEUR FINANCIER : JavaScriptCore introuvable, contrôles ignorés")
    else:
        print("\nMOTEUR FINANCIER")
        js = (SITE / "js" / "app.js").read_text(encoding="utf-8")
        debut = js.index("/* ---------- postes de travaux ---------- */")
        fin = js.index("/* ---------- charts ---------- */")
        moteur = re.sub(r"function (read|renderItems)\(\)\{.*?\n\}\n", "",
                        js[debut:fin], flags=re.S)
        essai = RACINE / "outils" / "__moteur.js"
        essai.write_text(moteur + """
var $ = function(){ return {innerHTML:'', value:'', textContent:''}; };
function base(){ return {prix:200000,notairePct:7.5,fraisAcq:0,mobilier:5000,apport:35000,
 duree:20,taux:3.4,assur:0.34,fraisDossier:2500,loyer:900,vacance:5,copro:60,tf:1200,pno:180,
 gestion:0,entretien:5,ps:18.6,psPV:17.2,cfe:400,abattement:50,plafondDeficit:10700,partBati:85,
 amortBatiAns:30,amortTvxAns:15,amortMobAns:7,horizon:25,inflation:2,indexPrix:2,indexLoyer:2,
 indexCharges:2,fraisVente:5,bourse:4,fondsEuros:0,livretA:-0.3,regime:'lmnp-reel',tmi:30,ira:true,
 items:[{nom:'R',montant:20000,taux:5,duree:20,deduc:100}]}; }
function run(o){ var p=base(); for(var k in o) p[k]=o[k];
 p.travaux=p.items.reduce(function(s,i){return s+i.montant;},0); return compute(p); }
var lignes=[];
// Le TRI et le graphique de gain doivent dire la meme chose : si le taux boursier
// egale le TRI, les deux courbes se rejoignent exactement a l'horizon.
['lmnp-reel','reel-foncier','micro-foncier','lmnp-micro'].forEach(function(rg){
  var b=run({regime:rg});
  var reel=((1+b.final.tri)/1.02-1)*100;
  var x=run({regime:rg, bourse:reel});
  lignes.push('coherence TRI/graphique '+rg+'|'+(Math.abs(x.final.gainImmo-x.final.gainBourse)<1?1:0)
    +'|ecart '+(x.final.gainImmo-x.final.gainBourse).toFixed(2)+' EUR');
});
lignes.push('CFE exoneree la premiere annee|'
  +(Math.abs(run({}).rows[0].charges-run({cfe:0}).rows[0].charges)<0.01?1:0)+'|');
lignes.push('CFE neutralisee en location nue|'
  +(Math.abs(run({regime:'reel-foncier',cfe:400}).final.tri-run({regime:'reel-foncier',cfe:0}).final.tri)<1e-9?1:0)+'|');
lignes.push('apport nul : TRI non calculable|'+(run({apport:0}).final.tri===null?1:0)+'|');
lignes.push('duree amortissement nulle sans plantage|'+(isFinite(run({amortBatiAns:0}).final.tri)?1:0)+'|');
lignes.push('horizon 1 an sans plantage|'+(isFinite(run({horizon:1}).final.tri)?1:0)+'|');
print(lignes.join('\\n'));
""", encoding="utf-8")
        try:
            sortie = subprocess.run([jsc, str(essai)], capture_output=True,
                                    text=True, timeout=90)
            if sortie.returncode != 0:
                # Moteur cassé : sa sortie n'a pas le format attendu, ne pas
                # l'analyser — le vérificateur planterait au lieu de rapporter.
                message = (sortie.stderr.strip() or sortie.stdout.strip())
                controle("moteur exécutable", False,
                         message.splitlines()[0][:70] if message else "échec")
            else:
                for ligne in sortie.stdout.strip().splitlines():
                    parts = ligne.split("|")
                    if len(parts) == 3:
                        controle(parts[0], parts[1] == "1", parts[2])
        finally:
            essai.unlink(missing_ok=True)

    rates = resultats.count(False)
    print("\n%d contrôles, %d échec(s)" % (len(resultats), rates))
    return 1 if rates else 0


if __name__ == "__main__":
    sys.exit(main())
