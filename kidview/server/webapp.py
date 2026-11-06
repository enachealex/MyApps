"""Pages for phones: the KidView Parent web app (what iPhones and other phones need to install the
dashboard from the browser, "Add to Home Screen"; the icons are the Android parent app's art), and the
page a child's device opens from the kid setup QR code (download KidView, then open it set up)."""
import base64
import html
import re
from urllib.parse import quote, urlencode

ICONS = {
    180: base64.b64decode(
        "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"
    ),
    192: base64.b64decode(
        "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"
        "sywok0mpOGd10fhPpz9XXR0xTCOzditYpt0+KcLhYHnZwfvumRGNxABURjMkpQJQ0UjsvntmlJcdDIeDwhE0aLzJg81wbnBd"
        "8dbp055mjGUuQy49jLHp055eV7w1nBt0nMy7ti4zsrCvP/pQTuCL0r01NXU33jzYja8za8Kru92MiE889qdF81e2aZeXifRk"
        "KkDuBxAI+ouLNn31Vc0Nw641DF0I6cHZQt+w3ZxIpJ547E//9/rCgjZ5wsnUKzMzFSA3LwvlBNau2fLPdduGDL0mPz8sRAbs"
        "D7kZ+/59X06f9vSSwqK27fI82+uT/bf1OI5o2z6/ZH3pXXf8YlPJTu/n9m7Gvqlk5113/KJkfWnb9vmOk9nX9WawA9WvZabf"
        "l0ik3p2ztP0lba7u210Iiei5ofdKKTdjf/sfHz10/zOWZQeCfuFk/GXPGQ/QiUHBGmO4eMGqSCR245jrEFEKiZ4JiaSQjDHG"
        "8Mlfv/r8M38NBExN07KjOyUbAKof/+b3+9YWb962Zc/omwaZfp9HSmaOI7jGo5HYg/c/M++dj/PyczL9XqIsBKgeo2DQv31b"
        "2fKP1119TfdOl7Z3GyRaajlzPYZztnHDzvv/7cnP120rKAhnWW9uVgHkbhEFg/6jR6oXzluhFAy8rg/nTDgCEZsTI6WUFJJz"
        "LqV65cU5j/3HrGNVkdzckJP5QU+WA+QyZBg6ACxbunbtms09e1/R8TvtmjMqOhHxsC2bdj38wLNz/vGh32+6O1WQdcpCgOr7"
        "0kOhQEXF4YXzVtqW/d2+3X2mIaVs0hXN/fmMs1gs8cof5zz+yxcP7K/Mzw9ncSNldgJ0cu6iaSgFy5et+2T5+su7dOxyRaf6"
        "8/YXFyMpj2fpiPjpJxt+8uOZC+at8PtN0zSy+0BSxjSUwQUNoebxeFJJNWxk/0d++cO+115VH+FeeJrW8Ods3rTrheffXL2q"
        "BBkGg/7si3haKUAnhnxhNBILhvwTJo2+78eTul/VuX5/jzHWWD9S6vjpY9fJdu/a/8b/zl84f2U8lgznhjK9z4QAOtsQcSaE"
        "jERiBQXhG4Zde8+944cO7wcnigz1NJzjnrL71zVFG2f/bXHx6k3V1dHc3FBrO0TbugA6jpHGHduJx5Jc4yNGDZgwefTtdwx3"
        "EzcpJOBZ1zUpJajjd7Zblr2ksGjhvJWffrJBOCIY8mu6JlrBmkUAnXQjpVRdXUIK2avPleMnjJwy9eYOHdue8BiJyNz+EPev"
        "bvsOAFR+WfXe2x8vXriqdHs54ywnJ9Aik9EJIG/ERpwhYCKRTKfttm3zbhs/bMrUsf0G9Gx40q/ekDZu2Pne20s/WLy6qqrW"
        "59MDAb8CJVsrOgTQKSE2IrNtOx5L+kxj4KDeN40dMvLGgd26dwaAysqq9xcVLfvosw3/3JFOWcGQX9d1pWSrnXxFAJ316Jk7"
        "wiEeT9qWE84NDhjUOxwOrf1sy5Evq3RDDwb97gta7dQ9Auhc78VBhsIRiURKChkImLpPV1K1wkFpkFmDxsEzTWogAQBCoQAi"
        "SKlaYXpFAF20fgxS1vZEkwggEgFEIoBIJAKIRACRCCASAUQiEUAkAohEAJEIIBKJACIRQCQCiEQAkUgEEIkAIhFAJAKIRACR"
        "SAQQiQAiEUAkAohEIoBIBBCJACIRQCQSAUQigEie1f8DVvrcV0N9Q6IAAAAASUVORK5CYII="
    ),
    512: base64.b64decode(
        "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"
        "vnHFTbdd1vOME0Rk+bK1HwwaP/T9CYsWrjDGRKIh22cbz/PKu7u8VpJ1VM/jczponKbCvf/1ZeklRp3ZPact3okhACBl28JM"
        "i0g6nU2lMsGg/6xzT7rp1j59rjinbbtqETHGGGO+1uWoBx++8577b5swbmb/d0dNHD+rbktjMOQPh4Mi4nmmPN+aMiJKyTGH"
        "FeVRSiUirhzRzgsHjMsLAQQAym+VXzuO29SUMJ45pnPH3pecedNtfXqesfX5I9f1lBKttVIqP8T7/b7LrjjnsivO2bEg8Dwv"
        "Eg35/L4yLAiMEcsyXY9yxSu+ZXSlRBx1ZAe3OmrqY8pnC4XAnj9Ujy438hVQelP+ZCJdURk557yTb7zl0suuOCcaDeen/J5n"
        "tFa7D2nGiOdtTQURyWZzE8bNHDFs0qjhUzZtqgsE/OFwQCnteV65FARKHFf6/abhpBNzXkppXWTpJZYkU+qGR2tWb9RBH69F"
        "UgFASnh3VymlXXfrlL/z1468+roLb7z50m4ndN5lym9Z6svmjPnw2KUg2PD5liHvTxg8YOz8uUuzOSe6tSAwXkm/Pbj9CFDn"
        "jq44RVkBeI5EqrzOHd1la62Q3wgBQACg9Map/IQ9mUxnMrmKinDvS8/a45Tf2ucroVorEbW1IBA5vGO77//wpn/7/g1TJs5+"
        "b8DYsaOmbtxY5/PZkUgov7FcwgWBMUU+cTZM/AkAlOqUX2sn58Sa4kqpbid0vvb6i66+9sKuxx+zbcrvKqW1Vl825d9rtOQz"
        "wxjjeZ5lWRdc1POCi3rmC4JRwyfPmLYgnc6Gw8FAwJ//v+GHAgIAaPYDncZ4qVQmnc62aVN5zfUX3XJbn169T/f7fTtP+a1D"
        "eGtMRDzPM2ZrQfD9H940a8bCge+OHjVi6to1G3w+O1yiBUGx/7th75cAQOlM+XPZXGNDLBD0H3d8p6uuveC6Gy7+Wpejdljl"
        "Vwc85d+XS2TbCwKtdc8zTuh5xgk/fvSuUSOmDuw3aub0hVsLgqC/ZHYItBLbKu59bNti8Z8AQPFP+ZPJTCaTPeywNtdef/GN"
        "N19yzvmn2PYXE/N8V58WayOx/V+3bbvq2++88vY7r9xeEKxZs8FnW+FIyLYt1y3igsCypCmpNtTqLlWOyRXZPrAxoixJJ9TG"
        "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"
    ),
}

MANIFEST = {
    "name": "KidView Parent",
    "short_name": "KidView",
    "description": "Manage KidView for your kids: watching, rules, activity and more.",
    "start_url": "/admin?app=1",
    "scope": "/",
    "display": "standalone",
    "background_color": "#f5f6f8",
    "theme_color": "#2b2350",
    "icons": [
        {"src": "/admin/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/admin/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    ],
}


# ---------------------------------------------------------------- kid setup page (/add)

KIDS_APP_ID = "com.thejumpvault.kidview"

_ADD_STYLE = """
:root { --bg: #f4f1ff; --card: #fff; --text: #241c4a; --muted: #6b6880; --accent: #6c4bf4; --line: #e6e1fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #15122a; --card: #201b3d; --text: #efeaff; --muted: #aaa3c7; --line: #2f2856; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 520px; margin: 0 auto; padding: 28px 18px 40px; }
.logo { width: 56px; height: 56px; border-radius: 16px; background: var(--accent); color: #fff; display: grid; place-items: center; font-size: 26px; }
h1 { font-size: 26px; line-height: 1.2; margin: 16px 0 6px; }
.lead { color: var(--muted); margin: 0 0 20px; }
ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; counter-reset: s; }
li { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px 18px 18px 62px; position: relative; counter-increment: s; }
li::before { content: counter(s); position: absolute; left: 18px; top: 18px; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; }
li b { display: block; font-size: 18px; }
li p { margin: 6px 0 12px; color: var(--muted); font-size: 15px; }
.btn { display: block; text-align: center; background: var(--accent); color: #fff; text-decoration: none; font-weight: 700; border-radius: 999px; padding: 14px 18px; }
.btn.alt { background: transparent; color: var(--accent); border: 2px solid var(--accent); }
.small { color: var(--muted); font-size: 14px; }
code { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; font-size: 15px; }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
"""


def _page(title: str, body: str) -> str:
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)}</title>'
            f'<meta name="robots" content="noindex"><style>{_ADD_STYLE}</style></head><body><main>'
            f'<div class="logo" aria-hidden="true">&#9654;</div>{body}</main></body></html>')


def add_page(server: str, code: str, code_ok: bool, apk_url: str | None, android: bool) -> str:
    """The page the kid setup QR code opens on a child's phone or tablet."""
    if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]{1,100}", server or ""):
        server = ""
    if not code_ok or not server:
        return _page("KidView setup code", '<h1>This setup code is out of date</h1>'
                     '<p class="lead">Ask a grown-up to open the KidView dashboard and scan the code shown there now.</p>')
    e = html.escape
    pair = "pair?" + urlencode({"server": server, "code": code})
    fallback = apk_url or ""
    open_link = (f"intent://{pair}#Intent;scheme=kidview;package={KIDS_APP_ID};"
                 + (f"S.browser_fallback_url={quote(fallback, safe='')};" if fallback else "") + "end")
    if not android:
        open_link = "kidview://" + pair
    install = (f'<a class="btn" href="{e(apk_url)}">Download KidView</a>' if apk_url
               else '<p>Ask a grown-up for the KidView app.</p>')
    phone_note = "" if android else ('<p class="note">KidView for kids works on <b>Android</b> phones and tablets. '
                                     'Scan this code with the child\'s Android device.</p>')
    body = f"""<h1>Set up KidView on this device</h1>
<p class="lead">Two steps, then it's ready to watch.</p>
{phone_note}
<ol>
  <li><b>Install KidView</b>
    <p>Tap the button, then open the file when it has downloaded. Android may ask you to allow installs from
    this browser, and Google Play Protect may ask you to confirm, because KidView isn't from the Play Store.</p>
    {install}</li>
  <li><b>Connect it to your home</b>
    <p>When KidView is installed, come back to this page and tap:</p>
    <a class="btn alt" href="{e(open_link)}">Open KidView</a>
    <p class="small">KidView opens with your home's details filled in. Give the device a name and tap Connect.</p></li>
</ol>
<p class="small">Didn't open? Open KidView and type the server address <code>{e(server)}</code> and the family code <code>{e(code)}</code>.</p>"""
    return _page("Set up KidView", body)
