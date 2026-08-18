#!/usr/bin/env python3
"""MYRA Brand Watch — scan Shopify catalogues, watch brands for new drops.

    python3 brand_watch.py https://www.anoncph.co.uk/     # scan + open the review sheet
    python3 brand_watch.py --add https://newbrand.com/    # add to the watchlist
    python3 brand_watch.py --check                        # what's new since last time
    python3 brand_watch.py --check --images               # and save the images
    python3 brand_watch.py --list                         # show the watchlist

Optional flags on any scan/check: --images (download packshots), --cloudinary
(upload to Cloudinary — needs CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET).

No API keys, no login, no dependencies beyond stock Python 3.
"""

import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(TOOL_DIR, "state.json")
STYLE_PATH = os.path.join(TOOL_DIR, "house_style.json")
TEMPLATE_PATH = os.path.join(TOOL_DIR, "brand-scanner.html")
SCANS_DIR = os.path.join(TOOL_DIR, "scans")
REVIEW_DIR = os.path.join(TOOL_DIR, "review")
IMAGES_DIR = os.path.join(TOOL_DIR, "images")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 MYRA-BrandWatch/1.0")

DEFAULT_HOUSE_STYLE = {
    "weights": {"colour": 3, "material": 2, "silhouette": 2},
    "house_colours": ["black", "white", "ivory", "cream", "ecru", "bone", "off white", "off-white",
                      "beige", "taupe", "sand", "camel", "tan", "caramel", "chocolate", "brown",
                      "cognac", "grey", "charcoal", "navy", "khaki", "olive", "burgundy",
                      "bordeaux", "oxblood"],
    "off_colours": ["neon", "fluo", "lime", "fuchsia", "hot pink", "bright pink", "turquoise",
                    "rainbow", "multicolour", "multicolor", "leopard", "zebra", "animal print",
                    "cow print", "snake print", "glitter", "holographic", "iridescent",
                    "metallic silver", "metallic gold"],
    "house_materials": ["leather", "suede", "calf", "nappa", "lambskin", "nubuck", "shearling",
                        "wool", "cashmere", "merino", "mohair", "silk", "cotton", "linen",
                        "poplin", "denim"],
    "off_materials": ["sequin", "diamante", "rhinestone", "pvc", "vinyl", "faux fur", "marabou",
                      "feather", "mesh rhinestone", "lurex", "glitter"],
    "house_silhouettes": ["pointed", "pointy", "slingback", "kitten heel", "stiletto", "ballet",
                          "ballerina", "loafer", "riding boot", "knee boot", "ankle boot", "column",
                          "straight leg", "wide leg", "tailored", "blazer", "trench", "slip dress",
                          "shirt dress", "square toe", "minimal", "clean", "structured", "longline"],
    "off_silhouettes": ["platform", "flatform", "chunky", "wedge sneaker", "extreme crop",
                        "cut-out", "cut out", "ruffle", "bow embellished", "ultra mini",
                        "micro mini"],
    "skip_categories": ["sock", "socks", "hair clip", "hair claw", "hairband", "scrunchie", "kids",
                        "child", "children", "baby", "gift card", "giftcard", "care kit",
                        "shoe care", "cleaner", "insole", "laces", "shoelace", "protector",
                        "candle", "keyring", "key ring", "phone case"],
    "new_days": 60,
}


# ---------------------------------------------------------------- io helpers

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def house_style():
    if not os.path.exists(STYLE_PATH):
        save_json(STYLE_PATH, DEFAULT_HOUSE_STYLE)
        print("wrote default house_style.json — edit it (or edit inline in the review sheet)")
    return load_json(STYLE_PATH, DEFAULT_HOUSE_STYLE)


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), r.headers.get("Content-Type", "")
    except urllib.error.URLError as e:
        # Apple/CLT python occasionally lacks a usable CA bundle — retry unverified once.
        if isinstance(getattr(e, "reason", None), ssl.SSLError) or "CERTIFICATE" in str(e).upper():
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                return r.read(), r.headers.get("Content-Type", "")
        raise


# ---------------------------------------------------------------- scanning

def normalise_base(url):
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    p = urllib.parse.urlparse(url)
    if not p.netloc:
        return None
    return "{}://{}".format(p.scheme, p.netloc)


def brand_slug(base):
    host = urllib.parse.urlparse(base).netloc
    host = re.sub(r"^www\.", "", host)
    return re.sub(r"[^a-z0-9]+", "-", host.split(".")[0].lower()).strip("-")


def normalise_product(p, base):
    price = None
    available = False
    for v in p.get("variants") or []:
        try:
            vp = float(v.get("price"))
        except (TypeError, ValueError):
            continue
        if price is None or vp < price:
            price = vp
        if v.get("available") is not False:
            available = True
    tags = p.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {
        "id": p.get("id"),
        "handle": p.get("handle"),
        "title": p.get("title") or "",
        "vendor": p.get("vendor") or "",
        "product_type": p.get("product_type") or "",
        "tags": tags,
        "url": "{}/products/{}".format(base, p.get("handle")),
        "price": price,
        "available": available,
        "published_at": p.get("published_at") or p.get("created_at"),
        "images": [i.get("src") for i in (p.get("images") or []) if i.get("src")][:8],
    }


def scan_brand(base):
    """Fetch the whole catalogue via /products.json. Returns a scan dict."""
    products = []
    page = 1
    started = time.time()
    while page <= 40:
        url = "{}/products.json?limit=250&page={}".format(base, page)
        try:
            body, ctype = http_get(url)
        except urllib.error.HTTPError as e:
            if page == 1:
                raise SystemExit(
                    "{} returned HTTP {} for /products.json — not a Shopify store, or the feed is "
                    "blocked (Cloudflare). Use the browser route: ask Claude to scan it with "
                    "Claude in Chrome.".format(base, e.code))
            break
        if page == 1 and "json" not in ctype and not body.lstrip()[:1] == b"{":
            raise SystemExit(
                "{} answered /products.json with {} instead of JSON — not a Shopify store, or "
                "blocked. Use the browser route (Claude in Chrome).".format(base, ctype or "HTML"))
        try:
            batch = json.loads(body).get("products") or []
        except ValueError:
            if page == 1:
                raise SystemExit(
                    "{} answered /products.json with something that isn't JSON — not Shopify, or "
                    "blocked. Use the browser route (Claude in Chrome).".format(base))
            break
        if not batch:
            break
        products.extend(normalise_product(p, base) for p in batch)
        sys.stdout.write("\r  page {} — {} products".format(page, len(products)))
        sys.stdout.flush()
        if len(batch) < 250:
            break
        page += 1
    print("\r  {} products read in {:.0f}s ({} pages)".format(
        len(products), time.time() - started, page))
    if not products:
        raise SystemExit("no products found at {}/products.json".format(base))

    vendors = {}
    for p in products:
        if p["vendor"]:
            vendors[p["vendor"]] = vendors.get(p["vendor"], 0) + 1
    brand_name = max(vendors, key=vendors.get) if vendors else brand_slug(base).replace("-", " ").title()

    return {"kind": "myra-brand-scan", "brand_name": brand_name, "brand_url": base,
            "scanned_at": now_iso(), "products": products}


# ---------------------------------------------------------------- images / cloudinary

def cdn_sized(url, width):
    return url + ("&" if "?" in url else "?") + "width={}".format(width)


def download_images(scan, only_products=None):
    products = only_products if only_products is not None else scan["products"]
    slug = brand_slug(scan["brand_url"])
    out_dir = os.path.join(IMAGES_DIR, slug)
    os.makedirs(out_dir, exist_ok=True)
    done = 0
    for p in products:
        if not p["images"]:
            continue
        path = os.path.join(out_dir, "{}.jpg".format(p["handle"]))
        if os.path.exists(path):
            done += 1
            continue
        try:
            body, _ = http_get(cdn_sized(p["images"][0], 1400), timeout=60)
            with open(path, "wb") as f:
                f.write(body)
            done += 1
            sys.stdout.write("\r  images: {}/{}".format(done, len(products)))
            sys.stdout.flush()
        except Exception:
            continue
    print("\r  images: {} saved to images/{}/".format(done, slug))


def cloudinary_upload(scan, only_products=None):
    cloud = os.environ.get("CLOUDINARY_CLOUD_NAME")
    preset = os.environ.get("CLOUDINARY_UPLOAD_PRESET")
    if not cloud or not preset:
        print("  cloudinary skipped — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET")
        return
    products = only_products if only_products is not None else scan["products"]
    slug = brand_slug(scan["brand_url"])
    endpoint = "https://api.cloudinary.com/v1_1/{}/image/upload".format(cloud)
    done = 0
    for p in products:
        if not p["images"] or p.get("cloudinary_url"):
            continue
        form = urllib.parse.urlencode({
            "file": p["images"][0],
            "upload_preset": preset,
            "public_id": "myra/{}/{}".format(slug, p["handle"]),
        }).encode()
        req = urllib.request.Request(endpoint, data=form, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                p["cloudinary_url"] = json.loads(r.read()).get("secure_url")
                done += 1
                sys.stdout.write("\r  cloudinary: {}/{}".format(done, len(products)))
                sys.stdout.flush()
        except Exception as e:
            print("\n  cloudinary error on {}: {}".format(p["handle"], e))
    print("\r  cloudinary: {} uploaded to myra/{}/".format(done, slug))


# ---------------------------------------------------------------- review sheets

def write_review_sheet(scan, filename):
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()
    style = house_style()
    payload = ("<script>window.EMBEDDED_SCAN = {};\nwindow.EMBEDDED_STYLE = {};</script>"
               .format(json.dumps(scan, ensure_ascii=False).replace("</", "<\\/"),
                       json.dumps(style, ensure_ascii=False).replace("</", "<\\/")))
    html = template.replace("</body>", payload + "\n</body>")
    os.makedirs(REVIEW_DIR, exist_ok=True)
    path = os.path.join(REVIEW_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


# ---------------------------------------------------------------- state / watchlist

def load_state():
    return load_json(STATE_PATH, {"brands": {}})


def record_seen(state, scan, watch=None):
    slug = brand_slug(scan["brand_url"])
    entry = state["brands"].setdefault(slug, {
        "name": scan["brand_name"], "url": scan["brand_url"],
        "watch": False, "seen_ids": [], "added": now_iso(),
    })
    entry["name"] = scan["brand_name"]
    if watch is not None:
        entry["watch"] = watch
    seen = set(entry["seen_ids"])
    seen.update(p["id"] for p in scan["products"] if p["id"] is not None)
    entry["seen_ids"] = sorted(seen)
    entry["last_checked"] = now_iso()
    save_json(STATE_PATH, state)
    return entry


# ---------------------------------------------------------------- commands

def cmd_scan(url, images=False, cloudinary=False, open_sheet=True):
    base = normalise_base(url)
    if not base:
        raise SystemExit("that doesn't look like a URL: {}".format(url))
    print("scanning {} ...".format(base))
    scan = scan_brand(base)
    if cloudinary:
        cloudinary_upload(scan)
    if images:
        download_images(scan)

    slug = brand_slug(base)
    day = datetime.now().strftime("%Y-%m-%d")
    os.makedirs(SCANS_DIR, exist_ok=True)
    scan_path = os.path.join(SCANS_DIR, "{}-{}.json".format(slug, day))
    save_json(scan_path, scan)
    sheet = write_review_sheet(scan, "{}-{}.html".format(slug, day))
    record_seen(load_state(), scan)
    print("  scan saved:   {}".format(os.path.relpath(scan_path, TOOL_DIR)))
    print("  review sheet: {}".format(os.path.relpath(sheet, TOOL_DIR)))
    if open_sheet:
        webbrowser.open("file://" + urllib.request.pathname2url(sheet))
    return scan


def cmd_add(url):
    base = normalise_base(url)
    if not base:
        raise SystemExit("that doesn't look like a URL: {}".format(url))
    print("adding {} to the watchlist (baseline scan, no sheet) ...".format(base))
    scan = scan_brand(base)
    entry = record_seen(load_state(), scan, watch=True)
    print("  watching {} — {} products on the baseline".format(entry["name"], len(entry["seen_ids"])))


def cmd_check(images=False, cloudinary=False):
    state = load_state()
    watched = {s: b for s, b in state["brands"].items() if b.get("watch")}
    if not watched:
        print("watchlist is empty — add a brand with: python3 brand_watch.py --add https://brand.com/")
        return
    day = datetime.now().strftime("%Y-%m-%d")
    total_new = 0
    for slug, entry in watched.items():
        print("checking {} ...".format(entry["name"]))
        try:
            scan = scan_brand(entry["url"])
        except SystemExit as e:
            print("  ! {}".format(e))
            continue
        seen = set(entry["seen_ids"])
        new = [p for p in scan["products"] if p["id"] not in seen]
        record_seen(state, scan, watch=True)
        state = load_state()
        if not new:
            print("  nothing new since last check")
            continue
        total_new += len(new)
        new_scan = dict(scan, products=new,
                        brand_name="{} — {} NEW".format(scan["brand_name"], len(new)))
        if cloudinary:
            cloudinary_upload(new_scan, new)
        if images:
            download_images(new_scan, new)
        sheet = write_review_sheet(new_scan, "{}-new-{}.html".format(slug, day))
        print("  {} new products -> {}".format(len(new), os.path.relpath(sheet, TOOL_DIR)))
        if sys.stdout.isatty():
            webbrowser.open("file://" + urllib.request.pathname2url(sheet))
    print("done — {} new product(s) across {} brand(s)".format(total_new, len(watched)))


def cmd_list():
    state = load_state()
    brands = state["brands"]
    if not brands:
        print("nothing in state yet")
        return
    for slug, b in sorted(brands.items()):
        print("{:9} {:28} {:5} products seen   last checked {}".format(
            "WATCHING" if b.get("watch") else "scanned",
            b["name"][:28], len(b["seen_ids"]), (b.get("last_checked") or "never")[:10]))


def main(argv):
    args = [a for a in argv[1:]]
    images = "--images" in args
    cloudinary = "--cloudinary" in args
    args = [a for a in args if a not in ("--images", "--cloudinary")]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return
    if args[0] == "--list":
        cmd_list()
    elif args[0] == "--check":
        cmd_check(images=images, cloudinary=cloudinary)
    elif args[0] == "--add":
        if len(args) < 2:
            raise SystemExit("usage: python3 brand_watch.py --add https://brand.com/")
        cmd_add(args[1])
    elif args[0].startswith("--"):
        raise SystemExit("unknown flag {} — try --help".format(args[0]))
    else:
        cmd_scan(args[0], images=images, cloudinary=cloudinary)


if __name__ == "__main__":
    main(sys.argv)
