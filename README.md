# MubarakLab — studio site

Static site for [mubaraklabs.com](https://mubaraklabs.com). Plain HTML/CSS, no
build step. Hosted on GitHub Pages.

## Structure

Take Studio pages live at `/takestudio/`, `/support/takestudio/`, `/privacy/takestudio/` and `/terms/takestudio/`. They use the existing studio contact, describe the implemented local workflow and link Apple's standard EULA. The app is live on the App Store; the product page carries its Smart App Banner and store badge.

```
index.html              Landing page
styles.css              Shared styles (auto dark mode)
    privacy/_template/      Privacy policy template
    terms/_template/        Terms of use template
    support/                App support pages
    references/             App-specific educational references
404.html                Not-found page
CNAME                   Custom domain for GitHub Pages
```

## Adding pages for a new app

For an app called "Focus Timer" with URL slug `focustimer`:

```sh
cp -r privacy/_template privacy/focustimer
cp -r terms/_template terms/focustimer
```

Then in both new `index.html` files, replace:

| Placeholder    | Replace with                          |
|----------------|---------------------------------------|
| `APP_NAME`     | Focus Timer                           |
| `APP_SLUG`     | focustimer                            |
| `UPDATED_DATE` | Today's date, e.g. June 11, 2026      |

Review the HTML comments inside each template — if the app collects data or
has in-app purchases, update those sections accordingly.

The pages go live at:

- `https://mubaraklabs.com/privacy/focustimer/`
- `https://mubaraklabs.com/terms/focustimer/`

Commit and push to deploy:

```sh
git add -A && git commit -m "Add Focus Timer policy pages" && git push
```

## Marketing conventions (MKT-01)

- Live apps carry `<meta name="apple-itunes-app" content="app-id=...">`, Open Graph and Twitter Card tags, and Apple's "Download on the App Store" badge.
- Store links use `?pt=127572059&ct=site-<page>&mt=8` (`site-home-<app>` on the homepage).
- `sitemap.xml` and `robots.txt` live at the site root. Add new public pages to the sitemap; unreleased apps get no banner or store link.
- No analytics or third-party scripts.
